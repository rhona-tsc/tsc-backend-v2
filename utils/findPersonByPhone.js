import Musician from "../models/musicianModel.js";

// --- Normaliser (shared across project) ---
function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

// --- Lookup musician directly in DB ---
export const findPersonByPhone = async (fromValue) => {
  const q = normalizePhoneE164(fromValue);
  if (!q) {
    console.warn("⚠️ findPersonByPhone called without valid phone:", fromValue);
    return null;
  }

  console.log("🔍 [findPersonByPhone] Searching musician DB for:", q);

  // All possible phone variants
  const candidates = [
    q,
    q.replace(/^\+44/, "0"),
    q.replace(/^\+44/, "44"),
  ].filter(Boolean);

  // Query all likely phone fields
  const musician = await Musician.findOne({
    $or: [
      { phone: { $in: candidates } },
      { phoneNormalized: { $in: candidates } },
      { phoneNumber: { $in: candidates } },
      { "basicInfo.phone": { $in: candidates } },
    ],
  })
    .select("firstName lastName phone phoneNormalized phoneNumber basicInfo.phone instrument")
    .lean();

  if (musician) {
    console.log("✅ findPersonByPhone matched musician:", {
      q,
      matched:
        musician.phoneNormalized ||
        musician.phone ||
        musician.phoneNumber ||
        musician?.basicInfo?.phone,
      name: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
    });
    return musician;
  } else {
    console.warn("❌ No musician found for phone:", q);
    return null;
  }
};