// node scripts/backfill-act-cards.js
import mongoose from "mongoose";
import actModel from "../models/actModel.js";
import { upsertActCardFromAct } from "../services/actCard.service.js";

const MONGO = process.env.MONGO_URL || process.env.MONGODB_URI;

(async () => {
  try {
    await mongoose.connect(MONGO, { dbName: process.env.DB_NAME });
    console.log("✅ Connected");

    const cursor = actModel.find({
      status: { $in: ["approved", "live", "approved_changes_pending", "live_changes_pending"] }
    })
    .select("_id name tscName slug status images heroImage base_fee genres lineups instruments bandMembers")
    .lean()
    .cursor();

    let i = 0;
    for await (const act of cursor) {
      await upsertActCardFromAct(act);
      if (++i % 50 === 0) console.log(`…updated ${i} cards`);
    }

    console.log(`🎉 Finished. Upserted ${i} act cards.`);
    await mongoose.disconnect();
  } catch (e) {
    console.error("❌ Backfill failed:", e);
    process.exit(1);
  }
})();