// backend/controllers/availabilityHelpers.js
import Musician from "../models/musicianModel.js";
import {findPersonByPhone} from "../utils/findPersonByPhone.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { sendWAOrSMS } from "../utils/twilioClient.js";
import EnquiryMessage from "../models/EnquiryMessage.js";

/* -------------------------- phone normalisation -------------------------- */

const firstNameOf = (p) => {
  if (!p) return "there";

  // If it's a string like "Miça Townsend"
  if (typeof p === "string") {
    const parts = p.trim().split(/\s+/);
    return parts[0] || "there";
  }

  // Common first-name keys
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

  // Fall back to splitting a full name
  const full = p.name || p.fullName || p.displayName || "";
  if (full && String(full).trim()) {
    return String(full).trim().split(/\s+/)[0];
  }

  return "there";
};

const mapTwilioToEnquiryStatus = (s) => {
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
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

/**
 * Return common variants for a UK mobile number so we can match DB rows that
 * may be stored as +447..., 07..., or 447...
 */
function normalizeFrom(raw = "") {
  const e164 = normalizePhoneE164(raw);
  if (!e164) return [];
  const noPlus = e164.replace(/^\+/, "");
  const uk = noPlus.startsWith("44") ? noPlus : `44${noPlus}`;
  const seven = uk.replace(/^44/, "0");
  return [`+${uk}`, seven, uk];
}

/* --------------------------- picture URL picker -------------------------- */

function getPictureUrlFrom(obj = {}) {
  // strict priority; only return http(s) URLs
  const candidates = [
    // explicit profilePicture as a string or nested { url }
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
  try {
    const variants = normalizeFrom(phoneRaw || ""); // ["+447...", "07...", "447..."]
    if (!variants.length) return;

    const mus = await Musician.find({
      $or: [{ phone: { $in: variants } }, { phoneNumber: { $in: variants } }],
    })
      .select(
        "firstName lastName email phone phoneNumber musicianProfileImageUpload profileImage profilePicture.url photoUrl imageUrl"
      )
      .lean();

    console.log("🔎 debugLogMusicianByPhone", {
      input: phoneRaw,
      variants,
      matches: mus.map((m) => ({
        _id: m?._id?.toString?.(),
        name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
        email: m.email || null,
        phone: m.phone || m.phoneNumber || null,
        images: {
          musicianProfileImageUpload: m.musicianProfileImageUpload || null,
          profileImage: m.profileImage || null,
          profilePictureUrl: m.profilePicture?.url || null,
          photoUrl: m.photoUrl || null,
          imageUrl: m.imageUrl || null,
        },
      })),
    });
  } catch (e) {
    console.warn("⚠️ debugLogMusicianByPhone failed:", e?.message || e);
  }
}

export function resolveMatchedMusicianPhoto({ who, musicianDoc }) {
  const fromWho = getPictureUrlFrom(who || {});
  const fromDoc = getPictureUrlFrom(musicianDoc || {});
  return fromWho || fromDoc || "";
}

export function findPersonByMusicianId(act, musicianId) {
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

export const notifyDeputyOneShot = async ({
  act,
  lineupId,
  deputy,
  dateISO,
  formattedDate,
  formattedAddress,
  duties,
  finalFee,
  metaActId,
}) => {
  // local helpers
  const maskPhone = (p = "") =>
    String(p).replace(/^\+?(\d{2})\d+(?=\d{3}$)/, "+$1•••").replace(/(\d{2})$/, "••$1");
  const toE164 = (raw = "") => {
    let s = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
    if (!s) return "";
    if (s.startsWith("+")) return s;
    if (s.startsWith("07")) return s.replace(/^0/, "+44");
    if (s.startsWith("44")) return `+${s}`;
    return s;
  };

  try {
    console.log("🟡 notifyDeputyOneShot(): INPUT", {
      actId: String(act?._id || ""),
      lineupId: String(lineupId || ""),
      deputy: {
        name: `${deputy?.firstName || ""} ${deputy?.lastName || ""}`.trim(),
        phoneRaw: deputy?.phoneNumber || deputy?.phone || "",
        email: deputy?.email || "",
        _id: deputy?._id || deputy?.musicianId || null,
      },
      dateISO,
      formattedDate,
      formattedAddress,
      duties,
      finalFee,
      metaActId: String(metaActId || act?._id || ""),
    });

    // phones
    const phoneRaw  = deputy?.phoneNumber || deputy?.phone || "";
    const phoneE164 = toE164(phoneRaw); // +44…
    if (!phoneE164) {
      console.warn("❌ notifyDeputyOneShot(): Deputy has no usable phone");
      throw new Error("Deputy has no phone");
    }
    console.log("☎️  Deputy phone normalized:", {
      phoneRaw,
      phoneMasked: maskPhone(phoneE164),
    });

    // enquiry id
    const enquiryId = String(Date.now());

    // ensure an Availability stub exists (and capture identity fields)
    console.log("📝 Upserting Availability stub…");
    const availabilityDoc = await AvailabilityModel.findOneAndUpdate(
      { enquiryId },
      {
        $setOnInsert: {
          enquiryId,
          actId: act?._id || null,
          lineupId: lineupId || null,
          musicianId: deputy?.musicianId || deputy?._id || null,
          phone: phoneE164,
          duties,
          formattedDate,
          formattedAddress,
          fee: String(finalFee || ""),
          reply: null,
          inbound: {},
          dateISO,
          calendarInviteEmail: deputy?.email || null,
          createdAt: new Date(),
          actName: act?.tscName || act?.name || "",
          contactName: firstNameOf(deputy),
          musicianName: `${deputy?.firstName || ""} ${deputy?.lastName || ""}`.trim(),
          v2: true,
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    console.log("✅ Availability stub upserted:", {
      availabilityId: availabilityDoc?._id?.toString?.(),
      enquiryId,
      phoneMasked: maskPhone(phoneE164),
    });

    // WA template + the exact SMS fallback text we want the webhook to reuse
    const templateParams = {
      FirstName: firstNameOf(deputy),
      FormattedDate: formattedDate,
      FormattedAddress: formattedAddress,
      Fee: String(finalFee),
      Duties: duties,
      ActName: act?.tscName || act?.name || "the band",
      MetaActId: String(metaActId || act?._id || ""),
      MetaISODate: dateISO,
      MetaAddress: formattedAddress,
    };
    console.log("📦 Twilio template params:", templateParams);

    const smsBody =
      `Hi ${templateParams.FirstName}, you've received an enquiry for a gig on ` +
      `${templateParams.FormattedDate} in ${templateParams.FormattedAddress} ` +
      `at a rate of £${templateParams.Fee} for ${templateParams.Duties} duties with ` +
      `${templateParams.ActName}. Please indicate your availability 💫 Reply YES / NO.`;

    // ① Try WA; if creation fails, send SMS immediately (handled inside sendWAOrSMS)
    // ② If WA is accepted but later UNDDELIVERED/FAILED, twilioStatusV2 will send the SMS
    console.log("📤 Sending (WA → SMS fallback) to deputy…", {
      phoneMasked: maskPhone(phoneE164),
    });
    const sendRes = await sendWAOrSMS({
      to: phoneE164,        // helper adds whatsapp:+ internally
      templateParams,
      smsBody,              // cached for webhook fallback
    });

    // Persist outbound so webhook can locate on delivery failure
    await AvailabilityModel.updateOne(
      { _id: availabilityDoc._id },
      {
        $set: {
          status: sendRes?.status || "queued",
          messageSidOut: sendRes?.sid || null,        // WA sid (MM…) when accepted
          contactChannel: sendRes?.channel || "whatsapp",
          updatedAt: new Date(),
          "outbound.smsBody": smsBody,
          "outbound.sid": sendRes?.sid || null,
          // clear old mark so webhook can stamp it exactly once
          "outbound.smsFallbackSentAt": null,
        },
      }
    );

    // optional: mirror to EnquiryMessage (analytics/audit)
    const enquiry = await EnquiryMessage.create({
      enquiryId,
      actId: act?._id || null,
      lineupId: lineupId || null,
      musicianId: deputy?._id || deputy?.musicianId || null,
      phone: phoneE164,
      duties,
      fee: String(finalFee),
      formattedDate,
      formattedAddress,
      messageSid: sendRes?.sid || null,
      status: mapTwilioToEnquiryStatus(sendRes?.status),
      meta: {
        firstName: templateParams.FirstName,
        actName: templateParams.ActName,
      },
      templateParams,
      smsBody,
    });

    console.log("✅ EnquiryMessage created:", {
      enquiryMessageId: enquiry?._id?.toString?.(),
      enquiryId,
    });

    console.log("🏁 notifyDeputyOneShot(): DONE", {
      enquiryId,
      phoneMasked: maskPhone(phoneE164),
    });

    return { phone: phoneE164, enquiryId };
  } catch (err) {
    console.error("🔥 notifyDeputyOneShot() error:", err?.message || err);
    throw err;
  }
};

export async function handleLeadNegativeReply({ act, updated, fromRaw = "" }) {
  // 1) Find the lead in the lineup by phone (so we can access their deputies)
  const leadMatch = findPersonByPhone(act, updated.lineupId, updated.phone || fromRaw);
  const leadMember = leadMatch?.parentMember || leadMatch?.person || null;
  const deputies = Array.isArray(leadMember?.deputies) ? leadMember.deputies : [];

  console.log("👥 Deputies for lead:", deputies.map(d => ({
    name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
    phone: d.phoneNumber || d.phone || ""
  })));

  // 2) Build normalized phone list for deputies
  const norm = (v) => (String(v || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "")
    .replace(/^0(?=7)/, "+44")
    .replace(/^(?=44)/, "+")
  );

  const depPhones = deputies
    .map(d => ({ obj: d, phone: norm(d.phoneNumber || d.phone || "") }))
    .filter(x => !!x.phone);

  if (depPhones.length === 0) {
    console.log("ℹ️ No deputy phones to contact.");
    return { pinged: 0, reason: "no_deputy_phones" };
  }

  // 3) Current availability state for this act/date
  const prevRows = await AvailabilityModel.find({
    actId: updated.actId,
    dateISO: updated.dateISO,
  })
    .select({ phone: 1, reply: 1, updatedAt: 1, createdAt: 1 })
    .lean();

  const repliedYes = new Map(); // phone -> row
  const repliedNo  = new Map(); // phone -> row
  const pending    = new Map(); // phone -> most-recent row (no reply yet)

  for (const r of prevRows) {
    const p = norm(r.phone);
    if (!p) continue;
    const rep = String(r.reply || "").toLowerCase();
    if (rep === "yes") {
      repliedYes.set(p, r);
    } else if (rep === "no" || rep === "unavailable") {
      repliedNo.set(p, r);
    } else {
      const prev = pending.get(p);
      const ts = new Date(r.updatedAt || r.createdAt || 0).getTime();
      if (!prev || ts > new Date(prev.updatedAt || prev.createdAt || 0).getTime()) {
        pending.set(p, r);
      }
    }
  }

  // 4) Count active deputies (YES + pending)
  const activeYes = depPhones.filter(({ phone }) => repliedYes.has(phone));
  const activePending = depPhones.filter(({ phone }) => pending.has(phone));
  const activeCount = activeYes.length + activePending.length;

  const DESIRED = 3;
  const toFill = Math.max(0, DESIRED - activeCount);

  // 5) Re-ping stale pending deputies (> 6h since last activity)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  let rePingCount = 0;

  for (const { phone: p, obj } of activePending) {
    const row = pending.get(p);
    const last = new Date(row?.updatedAt || row?.createdAt || 0).getTime();
    if (Date.now() - last > SIX_HOURS) {
      const smsBody =     // (not used for booking confirmations )

        `Hi 5 ${firstNameOf(obj)}, you've received an enquiry for a gig on ` +
        `${updated.formattedDate} in ${updated.formattedAddress} at a rate of £${String(updated.fee)} for ` +
        `${updated.duties} duties with ${act.tscName}. ` +
        `Please indicate your availability 💫 Reply YES / NO.`;

      const sendRes = await sendWAOrSMS({
        to: p,
        templateParams: {
          FirstName: firstNameOf(obj),
          FormattedDate: updated.formattedDate,
          FormattedAddress: updated.formattedAddress,
          Fee: String(updated.fee || "300"),
          Duties: updated.duties || "Lead Vocal",
          ActName: act.tscName || act.name || "the band",
          MetaActId: String(act._id || ""),
          MetaISODate: updated.dateISO,
          MetaAddress: updated.formattedAddress,
        },
        smsBody,
      });

      await AvailabilityModel.updateOne(
        { _id: row?._id },
        {
          $set: {
            status: sendRes?.status || "queued",
            messageSidOut: sendRes?.sid || row?.messageSidOut || null,
            contactChannel: sendRes?.channel || row?.contactChannel || "whatsapp",
            updatedAt: new Date(),
          },
        }
      );

      rePingCount++;
    }
  }

  // 6) Top up with fresh deputies to reach 3 active
  let freshPinged = 0;

  if (toFill > 0) {
    const alreadyActive = new Set([
      ...activeYes.map(({ phone }) => phone),
      ...activePending.map(({ phone }) => phone),
    ]);

    const candidates = depPhones.filter(({ phone }) =>
      !repliedNo.has(phone) && !alreadyActive.has(phone)
    );

    for (const cand of candidates.slice(0, toFill)) {
      try {
        const { phone: depPhone, enquiryId: depEnquiryId } = await notifyDeputyOneShot({
          act,
          lineupId: updated.lineupId,
          deputy: cand.obj,
          dateISO: updated.dateISO,
          formattedDate: updated.formattedDate,
          formattedAddress: updated.formattedAddress,
          duties: updated.duties || "Lead Vocal",
          finalFee: String(updated.fee || "300"),
          metaActId: updated.actId,
        });

        console.log("📣 Deputy pinged:", {
          deputy: `${firstNameOf(cand.obj)} ${cand.obj.lastName || ""}`.trim(),
          phone: depPhone,
          enquiryId: depEnquiryId,
        });

        freshPinged++;
      } catch (e) {
        console.warn("⚠️ Failed to notify deputy:", e?.message || e);
      }
    }
  }

  console.log(`✅ Deputies active after lead NO/UNAVAILABLE: yes=${activeYes.length}, pending=${activePending.length}, rePinged=${rePingCount}, newlyPinged=${freshPinged}`);

  return {
    activeYes: activeYes.length,
    activePending: activePending.length,
    rePinged: rePingCount,
    newlyPinged: freshPinged,
  };
}



/* ------------------------- export default (optional) --------------------- */

export default {
  debugLogMusicianByPhone,
  resolveMatchedMusicianPhoto,
  findPersonByMusicianId, handleLeadNegativeReply
};