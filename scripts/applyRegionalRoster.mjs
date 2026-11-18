import "dotenv/config";
import { MongoClient, ObjectId, BSON } from "mongodb";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildRegionalRoster } from "../utils/buildRegionalRoster.js";
// Usage: node scripts/applyRegionalRoster.mjs /absolute/private/roster.json [--apply]
const filename = process.argv[2];
if (!filename || !path.isAbsolute(filename))
  throw Error("Provide an absolute path to the reviewed roster JSON");
const roster = JSON.parse(await fs.readFile(filename, "utf8"));
const apply = process.argv.includes("--apply");
if (apply) {
  const base =
    process.env.ROSTER_BACKEND_URL || "https://tsc-backend-v2.onrender.com";
  const response = await fetch(
    `${base.replace(/\/$/, "")}/api/roster-capabilities`,
    { signal: AbortSignal.timeout(10000) },
  );
  const version = response.ok ? await response.json() : null;
  if (
    !version?.regionalPools ||
    !version?.allocationExclusions ||
    version.version !== 1
  )
    throw Error(
      "Deploy and verify the new backend before applying regional roster data",
    );
}
const client = new MongoClient(
  process.env.MONGODB_URI || process.env.MONGO_URI,
  { serverSelectionTimeoutMS: 10000 },
);
try {
  await client.connect();
  const db = client.db();
  const act = await db.collection("acts").findOne({
    _id: new ObjectId(roster.actId),
    status: { $in: ["approved", "live", "Approved, changes pending"] },
  });
  if (!act) throw Error("Approved act not found");
  const profiles = await db
    .collection("musicians")
    .find(
      { profileDeletedAt: null },
      {
        projection: {
          firstName: 1,
          lastName: 1,
          basicInfo: 1,
          email: 1,
          phone: 1,
          profilePhoto: 1,
        },
      },
    )
    .toArray();
  const norm = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  const resolvePerson = (name) => {
    const mapped = roster.identityAliases?.[name] || name;
    const byId = roster.verifiedProfileIds?.[name];
    const matches = profiles.filter((p) =>
      byId
        ? String(p._id) === byId
        : norm(
            [
              p.firstName || p.basicInfo?.firstName,
              p.lastName || p.basicInfo?.lastName,
            ]
              .filter(Boolean)
              .join(" "),
          ) === norm(mapped),
    );
    return matches.length === 1 ? matches[0] : null;
  };
  const result = buildRegionalRoster({
    act,
    roster,
    resolvePerson,
    newId: () => new ObjectId(),
    newLineupId: randomUUID,
  });
  const oldPolicy = await db
    .collection("actrosterpolicies")
    .findOne({ actId: act._id });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = { ...result.summary, applied: false };
  if (apply) {
    const backup = path.join(
      path.dirname(filename),
      `roster-backup-${stamp}.ejson`,
    );
    await fs.writeFile(
      backup,
      BSON.EJSON.stringify({
        actId: act._id,
        lineups: act.lineups,
        policy: oldPolicy,
      }),
      { mode: 0o600 },
    );
    await db
      .collection("actrosterpolicies")
      .createIndex({ actId: 1 }, { unique: true });
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await db
          .collection("acts")
          .updateOne(
            { _id: act._id, lineups: act.lineups },
            { $set: { lineups: result.lineups, updatedAt: new Date() } },
            { session },
          );
        if (updated.matchedCount !== 1)
          throw Error("Act changed since review; no roster changes applied");
        const policies = db.collection("actrosterpolicies");
        if (oldPolicy) {
          const changed = await policies.updateOne(
            {
              _id: oldPolicy._id,
              exclusions: oldPolicy.exclusions,
              ...(oldPolicy.updatedAt
                ? { updatedAt: oldPolicy.updatedAt }
                : { updatedAt: { $exists: false } }),
            },
            { $set: { ...result.policy, updatedAt: new Date() } },
            { session },
          );
          if (changed.matchedCount !== 1)
            throw Error(
              "Roster rules changed since review; no changes applied",
            );
        } else {
          if (await policies.findOne({ actId: act._id }, { session }))
            throw Error(
              "Roster rules were created concurrently; refresh the review",
            );
          await policies.insertOne(
            {
              actId: act._id,
              ...result.policy,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }
    const saved = await db
      .collection("acts")
      .findOne({ _id: act._id }, { projection: { lineups: 1 } });
    const digest = (v) =>
      createHash("sha256").update(JSON.stringify(v)).digest("hex");
    if (digest(saved.lineups) !== digest(result.lineups))
      throw Error("Read-back verification failed; use the saved backup");
    report.applied = true;
    report.backup = backup;
  }
  await fs.writeFile(
    path.join(path.dirname(filename), "regional-roster-review.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
