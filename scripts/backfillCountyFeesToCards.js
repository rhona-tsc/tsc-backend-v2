// Usage:
//   MONGODB_URI="mongodb+srv://user:pass@cluster" node scripts/backfillCountyFeesToCards.mjs
// Optional:
//   --db tsc2025   --limit 200

import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) { console.error("Missing MONGODB_URI"); process.exit(1); }

const args = new Map(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/,""), true];
}));
const DB_NAME = String(args.get("db") || "tsc2025");
const LIMIT   = args.has("limit") ? Number(args.get("limit")) : null;

function pickCountyFees(src) {
  if (!src || typeof src !== "object") return {};
  const out = {};
  if (typeof src.forEach === "function") {
    src.forEach((v, k) => { const n = Number(v); if (Number.isFinite(n)) out[String(k)] = n; });
  } else {
    for (const [k, v] of Object.entries(src)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

(async () => {
  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  const db = client.db(DB_NAME);
  const Acts  = db.collection("acts");
  const Cards = db.collection("actfiltercards");

  let cur = Acts.find({}, { projection: { _id: 1, useCountyTravelFee: 1, costPerMile: 1, countyFees: 1 } }).sort({_id:1});
  if (LIMIT) cur = cur.limit(LIMIT);

  const ops = [];
  let scanned=0, matched=0, modified=0;

  while (await cur.hasNext()) {
    const a = await cur.next(); scanned++;
    const countyFees = pickCountyFees(a.countyFees);
    const hasCounty  = Object.keys(countyFees).length > 0;

    ops.push({
      updateOne: {
        filter: { actId: new ObjectId(a._id) },
        update: {
          $set: {
            countyFees,
            "travelModel.useCountyTravelFee": !!a.useCountyTravelFee,
            "travelModel.costPerMile": Number(a.costPerMile) || 0,
            "travelModel.hasCountyFees": hasCounty,
            "travelModel.type": hasCounty ? "county" : ((Number(a.costPerMile) > 0) ? "per-mile" : "mu"),
          }
        },
        upsert: false
      }
    });

    if (ops.length >= 500) {
      const res = await Cards.bulkWrite(ops, { ordered: false });
      matched += res.matchedCount || 0;
      modified += res.modifiedCount || 0;
      ops.length = 0;
      console.log(`bulk… matched=${matched} modified=${modified} after ${scanned}`);
    }
  }
  if (ops.length) {
    const res = await Cards.bulkWrite(ops, { ordered: false });
    matched += res.matchedCount || 0;
    modified += res.modifiedCount || 0;
  }

  console.log(`✅ Done. Acts scanned=${scanned}, cards matched=${matched}, cards modified=${modified}`);

  // sanity sample
  const sample = await Cards.findOne(
    { countyFees: { $exists: true, $ne: {} } },
    { projection: { name: 1, countyFees: { $slice: 5 }, travelModel: 1 } }
  );
  console.log("🔎 sample:", sample?.name || "(none)");
  if (sample) console.dir(sample, { depth: null });

  await client.close();
})();