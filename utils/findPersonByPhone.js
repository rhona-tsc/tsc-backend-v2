import Musician from "../models/musicianModel.js";

// --- Normalise UK phone numbers to +44 (E.164 format) ---
function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

/**
 * 🔍 Finds a musician directly from the Musician collection by phone number.
 * @param {string} fromValue - raw phone input (+447..., 07..., whatsapp:+447...)
 * @returns {Promise<{ type: 'musician', person: Object } | null>}
 */
export const findPersonByPhone = async (fromValue) => {
  const q = normalizePhoneE164(fromValue);
  if (!q) return null;

  console.log("📞 [findPersonByPhone] Searching musician DB for:", q);

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

  if (musician) {
    console.log("✅ Found musician by phone:", {
      name: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
      id: musician._id,
    });
    return { type: "musician", person: musician };
  }

  console.warn("⚠️ No musician found in DB for phone:", q);
  return null;
};