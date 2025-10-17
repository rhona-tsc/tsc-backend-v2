import Musician from "../models/musicianModel.js";

function normalizePhoneE164(raw = "") {
  let s = "";
  if (typeof raw === "object" && raw !== null) {
    s =
      raw.phone ||
      raw.phoneNormalized ||
      raw.phoneNumber ||
      raw.availabilityPhone ||
      "";
  } else {
    s = String(raw || "").trim();
  }

  s = s.replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

export const findPersonByPhone = async (fromValue) => {
  const q = normalizePhoneE164(fromValue);
  if (!q) {
    return null;
  }

  console.log("🔍 [findPersonByPhone] Searching musician DB for:", q);

  const candidates = [
    q,
    q.replace(/^\+44/, "0"),
    q.replace(/^\+44/, "44"),
  ].filter(Boolean);

  const musician = await Musician.findOne({
    $or: [
      { phone: { $in: candidates } },
      { phoneNormalized: { $in: candidates } },
      { phoneNumber: { $in: candidates } },
      { "basicInfo.phone": { $in: candidates } },
    ],
  })
    .select("firstName lastName phone phoneNormalized phoneNumber basicInfo.phone email images profilePicture profileImage photoUrl")
    .lean();

  if (musician) {
    console.log("✅ [Musician DB match]", {
      q,
      matched:
        musician.phoneNormalized ||
        musician.phone ||
        musician.phoneNumber ||
        musician?.basicInfo?.phone,
      name: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
      _id: musician._id,
    });
    return musician;
  } else {
    console.warn("❌ No musician found for phone:", q);
    return null;
  }
};