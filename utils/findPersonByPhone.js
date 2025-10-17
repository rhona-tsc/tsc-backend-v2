import Musician from "../models/musicianModel.js";

function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

export const findPersonByPhone = async (fromValue) => {
  // 🧠 Extract phone number if an object was passed
  let phoneRaw = fromValue;
  if (typeof fromValue === "object" && fromValue !== null) {
    phoneRaw =
      fromValue.phone ||
      fromValue.phoneNumber ||
      fromValue.phoneNormalized ||
      fromValue.From ||
      fromValue.to ||
      "";
  }

  console.log("🔍 [findPersonByPhone] Raw input before normalization:", { phoneRaw, type: typeof phoneRaw });
  const q = normalizePhoneE164(phoneRaw);
  if (!q) {
    console.warn("⚠️ findPersonByPhone called without valid phone:", fromValue);
    return null;
  }

  console.log("📞 [findPersonByPhone] Searching musician DB for:", q);
  console.log("🔎 Querying musician DB with:", {
    q,
    orFields: ["phoneNormalized", "phone", "phoneNumber", "basicInfo.phone"]
  });

  const musician = await Musician.findOne({
    $or: [
      { phoneNormalized: q },
      { phone: q },
      { phoneNumber: q },
      { "basicInfo.phone": q },
    ],
  })
    .select(
      "_id firstName lastName email phone phoneNumber phoneNormalized profilePicture musicianProfileImageUpload musicianProfileImage musicianProfilePhoto images photoUrl imageUrl"
    )
    .lean();

  console.log("📋 Musician DB lookup result (partial):", musician ? {
    _id: musician._id,
    name: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
    matchedPhone: musician.phoneNormalized || musician.phone || musician.phoneNumber || musician?.basicInfo?.phone,
  } : "none found");

  if (musician) {
    console.log("✅ Found musician by phone:", {
      name: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
      id: musician._id,
      phone: musician.phoneNormalized || musician.phone,
    });
    return { type: "musician", person: musician };
  }

  console.warn("⚠️ No musician found in DB for phone:", q);
  return null;
};