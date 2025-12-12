// Usage:
//   MONGODB_URI="mongodb+srv://user:pass@cluster/db" node scripts/rebuildRepertoireTokens.mjs
// Optional flags:
//   --limit 200   (only process first 200 acts)
//   --db tsc2025  (override db name)

import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI env var");
  process.exit(1);
}

const args = new Map(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const DB_NAME = String(args.get("db") || "tsc2025");
const LIMIT   = args.has("limit") ? Number(args.get("limit")) : null;

function normPhrase(s) {
  if (!s) return "";
  const parts = String(s).toLowerCase().match(/[a-z0-9]+/g);
  return parts ? parts.join(" ") : "";
}

function wordTokens(s) {
  if (!s) return [];
  return (String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
}

(async () => {
  const client = new MongoClient(MONGODB_URI, { ignoreUndefined: true });
  await client.connect();
  const db  = client.db(DB_NAME);
  const Acts = db.collection("acts");
  const Cards = db.collection("actfiltercards");

  console.log(`🔌 Connected → db=${DB_NAME}`);
  const query = {};
  const proj  = { _id: 1, selectedSongs: 1, name: 1, tscName: 1 };
  let cursor = Acts.find(query, { projection: proj }).sort({ _id: 1 });
  if (LIMIT) cursor = cursor.limit(LIMIT);

  let scanned = 0, matched = 0, modified = 0;
  const ops = [];

  while (await cursor.hasNext()) {
    const act = await cursor.next();
    scanned++;

    const titleWordSet  = new Set();
    const artistWordSet = new Set();
    const songPhraseSet   = new Set();
    const artistPhraseSet = new Set();

    for (const s of (act.selectedSongs || [])) {
      const title  = s?.title  || "";
      const artist = s?.artist || "";

      // full-phrase tokens (space-normalised, lowercased)
      const tP = normPhrase(title);
      const aP = normPhrase(artist);
      if (tP) songPhraseSet.add(tP);
      if (aP) artistPhraseSet.add(aP);

      // word tokens
      for (const w of wordTokens(title))  titleWordSet.add(w);
      for (const w of wordTokens(artist)) artistWordSet.add(w);
    }

    const repertoireTokens = Array.from(new Set([
      ...titleWordSet,
      ...artistWordSet,
      ...songPhraseSet,
      ...artistPhraseSet,
    ]));

    const artistTokens = Array.from(new Set([
      ...artistWordSet,
      ...artistPhraseSet,
    ]));

    // prepare bulk op: overwrite arrays on the card with this actId
    ops.push({
      updateOne: {
        filter: { actId: new ObjectId(act._id) },
        update: {
          $set: {
            repertoireTokens,
            artistTokens,
            songPhrases: Array.from(songPhraseSet),
            artistPhrases: Array.from(artistPhraseSet),
          }
        },
        upsert: false,
      }
    });

    if (ops.length >= 500) {
      const res = await Cards.bulkWrite(ops, { ordered: false });
      matched  += (res.matchedCount || 0);
      modified += (res.modifiedCount || 0);
      ops.length = 0;
      console.log(`🧱 bulkWrite… matched=${matched} modified=${modified} (after ${scanned} acts)`);
    }
  }

  if (ops.length) {
    const res = await Cards.bulkWrite(ops, { ordered: false });
    matched  += (res.matchedCount || 0);
    modified += (res.modifiedCount || 0);
  }

  console.log(`✅ Done. Acts scanned=${scanned}, cards matched=${matched}, cards modified=${modified}`);

  // quick sample log for sanity
  const sample = await Cards.findOne(
    { repertoireTokens: { $exists: true, $ne: [] } },
    { projection: { name: 1, repertoireTokens: { $slice: 12 }, songPhrases: { $slice: 5 }, artistPhrases: { $slice: 5 }, artistTokens: { $slice: 10 } } }
  );
  console.log("🔎 sample card:", sample?.name || "(none)");
  if (sample) console.dir(sample, { depth: null });

  await client.close();
})();