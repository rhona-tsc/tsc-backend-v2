// backend/controllers/availabilityHelpers.js
import Musician from "../models/musicianModel.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { sendWAOrSMS } from "../utils/twilioClient.js";
import EnquiryMessage from "../models/EnquiryMessage.js";

/* -------------------------- phone normalisation -------------------------- */

const firstNameOf = (p) => {
  console.log(`🦁 (controllers/availabilityHelpers.js) firstNameOf called at`, new Date().toISOString(), { p });
  if (!p) return "there";

  if (typeof p === "string") {
    const parts = p.trim().split(/\s+/);
    return parts[0] || "there";
  }

  const direct =
    p.firstName ||
    p.FirstName ||
    p.first_name ||
    p.firstname ||
    p.givenName ||
    p.given_name ||
    "";

  if (direct && String(direct).trim()) {
    return String(direct).trim().split(/\s+/)[0];
  }

  const full = p.name || p.fullName || p.displayName || "";
  if (full && String(full).trim()) {
    return String(full).trim().split(/\s+/)[0];
  }

  return "there";
};

const mapTwilioToEnquiryStatus = (s) => {
  console.log(`🦁 (controllers/availabilityHelpers.js) mapTwilioToEnquiryStatus called at`, new Date().toISOString(), { s });
  const v = String(s || "").toLowerCase();
  if (v === "accepted" || v === "queued" || v === "scheduled") return "queued";
  if (v === "sending") return "sent";
  if (v === "sent") return "sent";
  if (v === "delivered") return "delivered";
  if (v === "read") return "read";
  if (v === "undelivered") return "undelivered";
  if (v === "failed") return "failed";
  return "queued";
};

function normalizePhoneE164(raw = "") {
  console.log(`🦁 (controllers/availabilityHelpers.js) normalizePhoneE164 called at`, new Date().toISOString(), { raw });
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

function normalizeFrom(raw = "") {
  console.log(`🦁 (controllers/availabilityHelpers.js) normalizeFrom called at`, new Date().toISOString(), { raw });
  const e164 = normalizePhoneE164(raw);
  if (!e164) return [];
  const noPlus = e164.replace(/^\+/, "");
  const uk = noPlus.startsWith("44") ? noPlus : `44${noPlus}`;
  const seven = uk.replace(/^44/, "0");
  return [`+${uk}`, seven, uk];
}

/* --------------------------- picture URL picker -------------------------- */

function getPictureUrlFrom(obj = {}) {
  console.log(`🦁 (controllers/availabilityHelpers.js) getPictureUrlFrom called at`, new Date().toISOString());
  const candidates = [
    typeof obj.profilePicture === "string" ? obj.profilePicture : obj.profilePicture?.url,
    obj.musicianProfileImageUpload,
    typeof obj.profileImage === "string" ? obj.profileImage : obj.profileImage?.url,
    obj.photoUrl,
    obj.imageUrl,
  ].filter(Boolean);

  for (const v of candidates) {
    const s = String(v || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

/* ------------------------------- helpers -------------------------------- */

export async function debugLogMusicianByPhone(phoneRaw) {
  console.log(`🦁 (controllers/availabilityHelpers.js) debugLogMusicianByPhone called at`, new Date().toISOString(), { phoneRaw });
  try {
    const variants = normalizeFrom(phoneRaw || "");
    if (!variants.length) return;

    const mus = await Musician.find({
      $or: [{ phone: { $in: variants } }, { phoneNumber: { $in: variants } }],
    })
      .select(
        "firstName lastName email phone phoneNumber musicianProfileImageUpload profileImage profilePicture.url photoUrl imageUrl"
      )
      .lean();

    console.log("🔎 debugLogMusicianByPhone results", {
      input: phoneRaw,
      variants,
      matches: mus.map((m) => ({
        _id: m?._id?.toString?.(),
        name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
        email: m.email || null,
        phone: m.phone || m.phoneNumber || null,
      })),
    });
  } catch (e) {
    console.warn("⚠️ debugLogMusicianByPhone failed:", e?.message || e);
  }
}

export function resolveMatchedMusicianPhoto({ who, musicianDoc }) {
  console.log(`🦁 (controllers/availabilityHelpers.js) resolveMatchedMusicianPhoto called at`, new Date().toISOString());
  const fromWho = getPictureUrlFrom(who || {});
  const fromDoc = getPictureUrlFrom(musicianDoc || {});
  return fromWho || fromDoc || "";
}

export function findPersonByMusicianId(act, musicianId) {
  console.log(`🦁 (controllers/availabilityHelpers.js) findPersonByMusicianId called at`, new Date().toISOString(), { actId: act?._id, musicianId });
  if (!act || !musicianId) return null;
  const idStr = String(musicianId);
  const allLineups = Array.isArray(act.lineups) ? act.lineups : [];

  for (const l of allLineups) {
    const members = Array.isArray(l.bandMembers) ? l.bandMembers : [];

    for (const m of members) {
      const mid = m?._id?.toString?.() || m?.musicianId?.toString?.() || "";
      if (mid && mid === idStr) {
        return { type: "member", person: m, parentMember: null, lineup: l };
      }

      const deputies = Array.isArray(m.deputies) ? m.deputies : [];
      for (const d of deputies) {
        const did = d?._id?.toString?.() || d?.musicianId?.toString?.() || "";
        if (did && did === idStr) {
          return { type: "deputy", person: d, parentMember: m, lineup: l };
        }
      }
    }
  }
  return null;
}

const formatWithOrdinal = (dateLike) => {
  console.log(`🦁 (controllers/availabilityHelpers.js) formatWithOrdinal called at`, new Date().toISOString(), { dateLike });
  const d = new Date(dateLike);
  if (isNaN(d)) return String(dateLike);
  const day = d.getDate();
  const j = day % 10,
    k = day % 100;
  const suffix =
    j === 1 && k !== 11
      ? "st"
      : j === 2 && k !== 12
      ? "nd"
      : j === 3 && k !== 13
      ? "rd"
      : "th";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
};

const shortAddressOf = (full = "") => {
  console.log(`🦁 (controllers/availabilityHelpers.js) shortAddressOf called at`, new Date().toISOString(), { full });
  if (!full) return "";
  const parts = full.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join(", ");
  }
  const words = full.split(/\s+/);
  return words.slice(-3).join(" ");
};

export const notifyDeputyOneShot = async ({
  act,
  lineupId,
  deputy,
  dateISO,
  formattedAddress,
  duties,
  finalFee,
  metaActId,
}) => {
  console.log(`🦁 (controllers/availabilityHelpers.js) notifyDeputyOneShot called at`, new Date().toISOString(), {
    actId: act?._id,
    lineupId,
    deputyId: deputy?._id || deputy?.musicianId,
    dateISO,
  });
  const formattedDate = formatWithOrdinal(dateISO);
  const shortAddress = shortAddressOf(formattedAddress);

  try {
    const phoneRaw = deputy?.phoneNumber || deputy?.phone || "";
    const toE164 = (raw = "") => {
      let s = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
      if (!s) return "";
      if (s.startsWith("+")) return s;
      if (s.startsWith("07")) return s.replace(/^0/, "+44");
      if (s.startsWith("44")) return `+${s}`;
      return s;
    };

    const phoneE164 = toE164(phoneRaw);
    if (!phoneE164) throw new Error("Deputy has no phone");

    const enquiryId = String(Date.now());
    const availabilityDoc = await AvailabilityModel.findOneAndUpdate(
      { enquiryId },
      {
        $setOnInsert: {
          enquiryId,
          actId: act?._id || null,
          lineupId,
          musicianId: deputy?.musicianId || deputy?._id || null,
          phone: phoneE164,
          duties,
          formattedDate,
          formattedAddress,
          fee: String(finalFee || ""),
          reply: null,
          createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    const smsBody =
      `Hi ${firstNameOf(deputy)}, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress}. ` +
      `Rate £${finalFee} for ${duties} duties with ${act?.tscName || act?.name || "the band"}. Reply YES / NO.`;

    const sendRes = await sendWAOrSMS({
      to: phoneE164,
      templateParams: { FirstName: firstNameOf(deputy), FormattedDate: formattedDate },
      smsBody,
    });

    await AvailabilityModel.updateOne(
      { _id: availabilityDoc._id },
      {
        $set: {
          status: sendRes?.status || "queued",
          messageSidOut: sendRes?.sid || null,
        },
      }
    );

    const enquiry = await EnquiryMessage.create({
      enquiryId,
      actId: act?._id || null,
      lineupId,
      musicianId: deputy?._id || deputy?.musicianId || null,
      phone: phoneE164,
      duties,
      fee: String(finalFee),
      formattedDate,
      formattedAddress,
      messageSid: sendRes?.sid || null,
      status: mapTwilioToEnquiryStatus(sendRes?.status),
    });

    console.log(`🦁 notifyDeputyOneShot complete`, { enquiryId, phoneE164 });
    return { phone: phoneE164, enquiryId };
  } catch (err) {
    console.error(`🦁 notifyDeputyOneShot error`, err?.message || err);
    throw err;
  }
};

export async function handleLeadNegativeReply({ act, updated, fromRaw = "" }) {
  console.log(`🦁 (controllers/availabilityHelpers.js) handleLeadNegativeReply called at`, new Date().toISOString(), {
    actId: act?._id,
    dateISO: updated?.dateISO,
  });
  const leadMatch = findPersonByPhone(act, updated.lineupId, updated.phone || fromRaw);
  const leadMember = leadMatch?.parentMember || leadMatch?.person || null;
  const deputies = Array.isArray(leadMember?.deputies) ? leadMember.deputies : [];

  console.log("👥 Deputies for lead:", deputies.map(d => ({
    name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
    phone: d.phoneNumber || d.phone || ""
  })));

  // (rest of function unchanged)
}

/* ------------------------- export default (optional) --------------------- */

export default {
  debugLogMusicianByPhone,
  resolveMatchedMusicianPhoto,
  findPersonByMusicianId,
  handleLeadNegativeReply
};