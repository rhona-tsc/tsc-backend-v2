// node scripts/backfill-act-cards.js
import mongoose from "mongoose";

const MONGO = process.env.MONGO_URL || process.env.MONGODB_URI;


const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes("--dry");
const BATCH_SIZE = 500;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI not set");
  process.exit(1);
}

(async () => {
  await mongoose.connect(MONGODB_URI, { maxPoolSize: 10 });
  const db = mongoose.connection.db;

  // make sure we can match quickly by actId
  try {
    await db.collection("actfiltercards").createIndex({ actId: 1 });
  } catch (_) {}

  const actsCol = db.collection("acts");
  const cardsCol = db.collection("actfiltercards");

  const cursor = actsCol
    .find({}, { projection: { _id: 1, useCountyTravelFee: 1, costPerMile: 1 } })
    .batchSize(BATCH_SIZE);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  const ops = [];

  while (await cursor.hasNext()) {
    const act = await cursor.next();
    scanned++;

    const useCountyTravelFee = !!act.useCountyTravelFee;
    const costPerMile = Number(act.costPerMile) || 0;

    ops.push({
      updateOne: {
        filter: { actId: act._id },
        update: {
          $set: {
            useCountyTravelFee,
            costPerMile,
            // keep a compact summary mirror too if you want:
            "travelModel.useCountyTravelFee": useCountyTravelFee,
            "travelModel.costPerMile": costPerMile,
            "travelModel.type":
              useCountyTravelFee ? "county" : costPerMile > 0 ? "per-mile" : "mu",
          },
        },
        upsert: false, // only update existing cards
      },
    });

    if (ops.length >= BATCH_SIZE) {
      if (!DRY_RUN) {
        const res = await cardsCol.bulkWrite(ops, { ordered: false });
        updated += (res.modifiedCount || 0) + (res.upsertedCount || 0);
      } else {
        skipped += ops.length;
      }
      ops.length = 0;
      process.stdout.write(".");
    }
  }

  if (ops.length) {
    if (!DRY_RUN) {
      const res = await cardsCol.bulkWrite(ops, { ordered: false });
      updated += (res.modifiedCount || 0) + (res.upsertedCount || 0);
    } else {
      skipped += ops.length;
    }
  }

  console.log("\n✅ Done");
  console.log(`   Acts scanned:   ${scanned}`);
  console.log(`   Cards updated:  ${updated}${DRY_RUN ? " (dry run)" : ""}`);
  if (DRY_RUN) console.log(`   Ops previewed: ${skipped}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("\n❌ Error:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});