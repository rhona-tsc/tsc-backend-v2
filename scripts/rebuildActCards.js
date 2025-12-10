// scripts/rebuildActCards.js
import mongoose from "mongoose";
import Act from "../models/actModel.js";
import { upsertActCardFromAct } from "../services/actCard.service.js";

const MONGODB_URI = process.env.MONGODB_URI;

(async () => {
  await mongoose.connect(MONGODB_URI);
  const acts = await Act.find({ status: { $in: ["approved", "live"] } }).lean();

  for (const act of acts) {
    try {
      await upsertActCardFromAct(act);
      console.log("OK:", act._id, act.tscName || act.name);
    } catch (e) {
      console.error("FAIL:", act._id, e?.message);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})();