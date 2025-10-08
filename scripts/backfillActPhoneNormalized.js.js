// scripts/backfillActPhoneNormalized.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import actModel from "../models/actModel.js";

dotenv.config();

function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const acts = await actModel.find({});
  console.log(`Found ${acts.length} acts`);

  for (const act of acts) {
    let dirty = false;

    if (Array.isArray(act.lineups)) {
      for (const lineup of act.lineups) {
        if (Array.isArray(lineup.bandMembers)) {
          for (const m of lineup.bandMembers) {
            const src = m.phoneNumber || m.phone || "";
            const norm = normalizePhoneE164(src);
            if (norm && m.phoneNormalized !== norm) {
              m.phoneNormalized = norm;
              dirty = true;
            }
            if (Array.isArray(m.deputies)) {
              for (const d of m.deputies) {
                const dsrc = d.phoneNumber || d.phone || "";
                const dnorm = normalizePhoneE164(dsrc);
                if (dnorm && d.phoneNormalized !== dnorm) {
                  d.phoneNormalized = dnorm;
                  dirty = true;
                }
              }
            }
          }
        }
      }
    }

    if (dirty) {
      await act.save();
      console.log(`Updated act ${act._id}`);
    }
  }

  await mongoose.disconnect();
  console.log("Done ✅");
}

run().catch((err) => {
  console.error("Backfill error:", err);
  process.exit(1);
});