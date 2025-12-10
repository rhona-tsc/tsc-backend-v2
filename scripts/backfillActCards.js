// scripts/backfillActCards.js
import "dotenv/config.js";
import mongoose from "mongoose";
import actModel from "../models/actModel.js";
import ActCard from "../models/actCard.model.js";
import { upsertActCardFromAct } from "../controllers/helpers/upsertActCardFromAct.js";

const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/tsc";
const arg = (flag, def = null) => {
  const i = process.argv.findIndex((x) => x.startsWith(flag));
  if (i === -1) return def;
  const val = process.argv[i].split("=")[1];
  return val !== undefined ? val : true;
};

const concurrency = Number(arg("--concurrency", 8));
const onlyMissing = Boolean(arg("--only-missing", false));
const includeDrafts = Boolean(arg("--include-drafts", false));
const includeTrashed = Boolean(arg("--include-trashed", false));

(async () => {
  console.log("🔌 Connecting to Mongo…", MONGO);
  await mongoose.connect(MONGO, { maxPoolSize: 10 });
  console.log("✅ Connected");

  // Optional: ensure indexes exist (safe to run)
  try {
    console.log("🧭 Syncing ActCard indexes…");
    await ActCard.syncIndexes();
  } catch (e) {
    console.warn("⚠️ Index sync warning:", e.message);
  }

  const filter = {};
  if (!includeTrashed) filter.status = { $ne: "trashed" };
  if (!includeDrafts) {
    const allowed = ["approved", "live", "pending", "Approved, changes pending"];
    filter.$or = [{ status: { $in: allowed } }, { status: { $exists: false } }];
  }

  const total = await actModel.countDocuments(filter);
  console.log(`📊 Acts to process: ${total}`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const inFlight = new Set();

  const cursor = actModel.find(filter).lean().cursor();

  const queue = async (job) => {
    const p = job().catch((e) => {
      console.error("❌ Upsert error:", e?.message || e);
    }).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
  };

  for await (const act of cursor) {
    await queue(async () => {
      processed++;
      if (onlyMissing) {
        const exists = await ActCard.exists({ actId: act._id });
        if (exists) {
          skipped++;
          if (processed % 200 === 0) {
            console.log(`⏩ Skipped existing: ${skipped} / processed ${processed}`);
          }
          return;
        }
      }
      const card = await upsertActCardFromAct(act);
      updated++;
      if (processed % 100 === 0) {
        console.log(`🔁 Progress: ${processed}/${total} (updated ${updated}, skipped ${skipped})`);
      }
    });
  }

  await Promise.all(inFlight);
  console.log("🎉 Done",
    { processed, updated, skipped, total });

  await mongoose.disconnect();
  process.exit(0);
})();