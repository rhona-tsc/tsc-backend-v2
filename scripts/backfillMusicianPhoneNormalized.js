// scripts/backfillMusicianPhoneNormalized.js
import mongoose from "mongoose";

// ---- CONFIG ----
const MONGODB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/tsc";

// Use the same normalization you used in the schema pre-save
const normalizeToE164 = (v = "") => {
  let s = String(v || "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s; // unknown format -> leave as-is (or return "" if you prefer)
};

// Minimal musician model (avoid import side-effects); matches your collection name
const musicianSchema = new mongoose.Schema(
  {
    phone: String,
    phoneNumber: String,
    phoneNormalized: String,
    firstName: String,
    lastName: String,
  },
  { strict: false, collection: "musicians" } // ensure correct collection name if it's pluralized
);
const Musician = mongoose.models._tmp_musician || mongoose.model("_tmp_musician", musicianSchema);

(async () => {
  await mongoose.connect(MONGODB_URI, { autoIndex: false });
  console.log("👉 Connected.");

  const cursor = Musician.find(
    {
      $or: [
        { phone: { $exists: true, $ne: null } },
        { phoneNumber: { $exists: true, $ne: null } },
      ],
    },
    { phone: 1, phoneNumber: 1, phoneNormalized: 1, firstName: 1, lastName: 1 }
  ).cursor();

  let ops = [];
  let scanned = 0;
  let modified = 0;
  const BATCH = 500;

  for await (const doc of cursor) {
    scanned++;
    const current = doc.phoneNormalized || "";
    const candidate = normalizeToE164(doc.phone || doc.phoneNumber || "");
    if (candidate && candidate !== current) {
      modified++;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { phoneNormalized: candidate } },
        },
      });
    }

    if (ops.length >= BATCH) {
      await Musician.bulkWrite(ops, { ordered: false });
      console.log(`🔧 Applied batch. Modified so far: ${modified} / scanned ${scanned}`);
      ops = [];
    }
  }

  if (ops.length) {
    await Musician.bulkWrite(ops, { ordered: false });
    console.log(`🔧 Final batch applied.`);
  }

  console.log(`✅ Done. Scanned: ${scanned}, Updated: ${modified}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});