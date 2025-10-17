import Musician from "../models/musicianModel.js";

// Normaliser used everywhere
function normalizePhoneE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

export const findPersonByPhone = async (fromValue) => {
  const q = normalizePhoneE164(fromValue);
  if (!q) return null;
  const person = await Musician.findOne({
    $or: [
      { phone: q },
      { phoneNormalized: q },
      { "basicInfo.phone": q },
    ],
  }).lean();
  if (person) {
    console.log("✅ findPersonByPhone matched musician", {
      q,
      name: `${person.firstName || ""} ${person.lastName || ""}`.trim(),
      id: person._id,
      email: person.email,
    });
    return { type: "musician", person };
  }
  console.warn("⚠️ No musician found for phone", q);
  return null;
};