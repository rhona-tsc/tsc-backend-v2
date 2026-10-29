import "dotenv/config";
import mongoose from "mongoose";
import { EJSON } from "bson";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";

const APPLY = process.argv.includes("--apply");
const PRIMARY_ID = "68b4397a416f0bcd9cb6a244";
const DUPLICATE_ID = "696fca69a8c6fc3eba3446b1";
const REAL_EMAIL = "abbottshamyra@gmail.com";
const REAL_PHONE = "+447912884580";
const PRIMARY_ONLY_FIELDS = [
  "password",
  "inviteTokenHash",
  "inviteTokenExpires",
  "resetTokenHash",
  "resetTokenExpires",
  "mustChangePassword",
  "hasSetPassword",
  "lastLoginAt",
  "passwordLastChangedAt",
  "status",
  "tscApprovedBio",
  "approvedBioSource",
  "aiBioGeneratedAt",
  "aiBioModel",
  "aiBioReviewRequired",
  "aiBioReviewedAt",
  "aiBioSourceHash",
  "aiBioGenerationError",
  "tagLine",
  "tagLineSource",
  "aiTaglineGeneratedAt",
  "aiTaglineModel",
  "aiTaglineReviewRequired",
  "aiTaglineReviewedAt",
  "aiTaglineSourceHash",
  "aiTaglineGenerationError",
];

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) throw new Error("MONGODB_URI or MONGO_URI is required");

const isObjectId = (value) => value?._bsontype === "ObjectId";
const isPlainObject = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !isObjectId(value) &&
  !(value instanceof Date);

const isBlank = (value) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (isPlainObject(value) && Object.keys(value).length === 0);

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "_id")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
};

const unionArrays = (primary = [], duplicate = []) => {
  const merged = [...primary];
  const seen = new Set(primary.map((item) => JSON.stringify(canonicalValue(item))));
  for (const item of duplicate) {
    const key = JSON.stringify(canonicalValue(item));
    if (!seen.has(key)) {
      merged.push(item);
      seen.add(key);
    }
  }
  return merged;
};

const mergeValues = (primary, duplicate) => {
  if (Array.isArray(primary) || Array.isArray(duplicate)) {
    return unionArrays(
      Array.isArray(primary) ? primary : [],
      Array.isArray(duplicate) ? duplicate : [],
    );
  }
  if (isPlainObject(primary) || isPlainObject(duplicate)) {
    const left = isPlainObject(primary) ? primary : {};
    const right = isPlainObject(duplicate) ? duplicate : {};
    const output = { ...left };
    for (const [key, value] of Object.entries(right)) {
      output[key] = key in left ? mergeValues(left[key], value) : value;
    }
    return output;
  }
  return isBlank(primary) ? duplicate : primary;
};

const replaceDuplicateId = (value, primaryObjectId) => {
  if (isObjectId(value)) {
    return String(value) === DUPLICATE_ID ? primaryObjectId : value;
  }
  if (typeof value === "string") {
    return value === DUPLICATE_ID ? PRIMARY_ID : value;
  }
  if (Array.isArray(value)) {
    const replaced = value.map((item) => replaceDuplicateId(item, primaryObjectId));
    const seen = new Set();
    return replaced.filter((item) => {
      const key = JSON.stringify(canonicalValue(item));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        replaceDuplicateId(child, primaryObjectId),
      ]),
    );
  }
  return value;
};

await mongoose.connect(uri);

try {
  const db = mongoose.connection.db;
  const musicians = db.collection("musicians");
  const primaryObjectId = new mongoose.Types.ObjectId(PRIMARY_ID);
  const duplicateObjectId = new mongoose.Types.ObjectId(DUPLICATE_ID);
  const [primary, duplicate] = await Promise.all([
    musicians.findOne({ _id: primaryObjectId }),
    musicians.findOne({ _id: duplicateObjectId }),
  ]);

  if (!primary || !duplicate) {
    throw new Error("Both Shamyra profiles must exist before the merge");
  }
  if (
    primary.firstName !== "Shamyra" ||
    duplicate.firstName !== "Shamyra" ||
    primary.phoneNormalized !== REAL_PHONE
  ) {
    throw new Error("Profile identity check failed; refusing to merge");
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const references = [];
  for (const { name } of collections) {
    if (name === "musicians" || name === "profilemergebackups") continue;
    const cursor = db.collection(name).find({});
    for await (const document of cursor) {
      if (JSON.stringify(document).includes(DUPLICATE_ID)) {
        references.push({ collection: name, document });
      }
    }
  }

  const merged = mergeValues(primary, duplicate);
  for (const field of PRIMARY_ONLY_FIELDS) {
    if (field in primary) merged[field] = primary[field];
    else delete merged[field];
  }
  merged._id = primaryObjectId;
  merged.musicianId = primaryObjectId;
  merged.email = REAL_EMAIL;
  merged.phone = REAL_PHONE;
  merged.phoneNumber = REAL_PHONE;
  merged.phoneNormalized = REAL_PHONE;
  merged.musicianSlug = primary.musicianSlug || "shamyra-a";
  merged.password = primary.password;
  merged.basicInfo = {
    ...(merged.basicInfo || {}),
    firstName: "Shamyra",
    lastName: "Abbott",
    email: REAL_EMAIL,
    phone: REAL_PHONE,
  };
  merged.updatedAt = new Date();

  const additions = Object.keys(duplicate).filter(
    (key) =>
      !PRIMARY_ONLY_FIELDS.includes(key) &&
      isBlank(primary[key]) &&
      !isBlank(duplicate[key]),
  );
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        primary: { id: PRIMARY_ID, email: REAL_EMAIL, phone: REAL_PHONE },
        duplicate: {
          id: DUPLICATE_ID,
          email: duplicate.email,
          phone: duplicate.phoneNormalized || duplicate.phone,
        },
        fieldsAddedFromDuplicate: additions,
        referencesToMove: references.map(({ collection, document }) => ({
          collection,
          id: String(document._id),
        })),
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to complete the merge.");
  } else {
    const backupDirectory =
      "/Users/rhonadownie/Downloads/tsc-database-archives";
    const backupPath = `${backupDirectory}/shamyra-profile-merge-${Date.now()}.jsonl.gz`;
    mkdirSync(backupDirectory, { recursive: true });
    const snapshots = [
      { collection: "musicians", document: primary },
      { collection: "musicians", document: duplicate },
      ...references,
    ];
    const backupSource = Transform.from(
      (async function* () {
        for (const snapshot of snapshots) {
          yield `${EJSON.stringify(snapshot, { relaxed: false })}\n`;
        }
      })(),
    );
    await pipeline(
      backupSource,
      createGzip({ level: 9 }),
      createWriteStream(backupPath, { flags: "wx" }),
    );

    let verifiedSnapshots = 0;
    let carry = "";
    const backupCounter = new Transform({
      transform(chunk, encoding, callback) {
        carry += chunk.toString("utf8");
        const lines = carry.split("\n");
        carry = lines.pop();
        verifiedSnapshots += lines.filter(Boolean).length;
        callback();
      },
      flush(callback) {
        if (carry.trim()) verifiedSnapshots += 1;
        callback();
      },
    });
    await pipeline(createReadStream(backupPath), createGunzip(), backupCounter);
    if (verifiedSnapshots !== snapshots.length) {
      throw new Error("Local merge backup verification failed");
    }
    const backupSha256 = createHash("sha256")
      .update(readFileSync(backupPath))
      .digest("hex");

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const profileMergeId = new mongoose.Types.ObjectId();
        await db.collection("profilemergebackups").insertOne(
          {
            createdAt: new Date(),
            profileMergeId,
            recordType: "merge_header",
            reason: "Merge duplicate Shamyra Abbott profile into verified profile ending 580",
            primaryId: PRIMARY_ID,
            duplicateId: DUPLICATE_ID,
            primaryEmail: primary.email,
            duplicateEmail: duplicate.email,
            snapshotCount: references.length + 2,
            localBackupPath: backupPath,
            localBackupSha256: backupSha256,
          },
          { session },
        );

        await musicians.replaceOne({ _id: primaryObjectId }, merged, { session });

        for (const { collection, document } of references) {
          const replacement = replaceDuplicateId(document, primaryObjectId);
          await db
            .collection(collection)
            .replaceOne({ _id: document._id }, replacement, { session });
        }

        await musicians.deleteOne({ _id: duplicateObjectId }, { session });
      });
    } finally {
      await session.endSession();
    }

    console.log(
      JSON.stringify(
        {
          merged: true,
          removedDuplicate: DUPLICATE_ID,
          referencesMoved: references.length,
          backupCreated: true,
          backupPath,
          backupSha256,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await mongoose.disconnect();
}

