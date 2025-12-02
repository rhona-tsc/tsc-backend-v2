import AvailabilityModel from "../models/availabilityModel.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { cancelCalendarInvite } from "../controllers/googleController.js";
import { sendWhatsAppText } from "../utils/twilioClient.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { postcodes } from "../utils/postcodes.js"; // <-- ensure this path is correct in backend
import {sendEmail } from "../utils/sendEmail.js";
import mongoose from "mongoose";
import calculateActPricing from "../utils/calculateActPricing.js";
import { createCalendarInvite } from "./googleController.js";
import userModel from "../models/userModel.js";
import { computeMemberMessageFee } from "./helpersForCorrectFee.js";
import { makeShortId } from "../utils/makeShortId.js";

// Debugging: log AvailabilityModel structure at runtime
console.log("📘 [twilioInbound] AvailabilityModel inspection:");
if (AvailabilityModel?.schema?.paths) {
  const fieldNames = Object.keys(AvailabilityModel.schema.paths);
  console.log("📋 Fields:", fieldNames);
  console.log("📦 Collection name:", AvailabilityModel.collection?.name);
  console.log("🧱 Indexes:", AvailabilityModel.schema._indexes);
} else {
  console.warn("⚠️ AvailabilityModel missing schema.paths — check import");
}

// ───────────────────────────────────────────────────────────────────────────────
// Helper: consistent identity logging
// ───────────────────────────────────────────────────────────────────────────────
const logIdentity = (label, obj = {}) => {
  const firstName =
    obj.firstName ||
    obj.fn ||
    obj.givenName ||
    obj.selectedVocalistName?.split?.(" ")?.[0] ||
    "";
  const lastName =
    obj.lastName ||
    obj.ln ||
    obj.familyName ||
    (obj.selectedVocalistName?.includes?.(" ")
      ? obj.selectedVocalistName.split(" ").slice(1).join(" ")
      : "") ||
    "";
  const displayName =
    obj.displayName ||
    obj.musicianName ||
    obj.resolvedName ||
    `${firstName} ${lastName}`.trim();
  const vocalistDisplayName =
    obj.vocalistDisplayName ||
    obj.vocalistName ||
    obj.selectedVocalistName ||
    displayName;

  console.log(`👤 ${label}`, {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    displayName: displayName || undefined,
    vocalistDisplayName: vocalistDisplayName || undefined,
    address: obj.address || undefined,
    formattedAddress: obj.formattedAddress || undefined,
    profileUrl: obj.profileUrl || obj.tscProfileUrl || undefined,
    photoUrl:
      obj.photoUrl ||
      obj.profilePicture ||
      obj.profilePhoto ||
      obj.imageUrl ||
      undefined,
    isDeputy: Boolean(obj.isDeputy),
    slotIndex: obj.slotIndex ?? undefined,
    musicianId: obj.musicianId ? String(obj.musicianId) : undefined,
    phone: obj.phone || obj.phoneNormalized || undefined,
    reply: obj.reply || obj.state || undefined,
  });
};



/** Normalise stringy names from any source */
const normalizeNameBits = (nameLike) => {
  const s = (nameLike ?? "").toString().trim();
  if (!s) return { first:"", last:"", firstName:"", lastName:"", displayName:"", vocalistDisplayName:"" };
  const parts = s.split(/\s+/);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    first, last,
    firstName: first, lastName: last,
    displayName: s,
    vocalistDisplayName: s,
  };
};

/** Build a complete "primary" record for the badge slot */
function presentBadgePrimary({ row = {}, musicianDoc = {}, leadBits = {} }) {
  const id = String(row.musicianId || musicianDoc?._id || '');
  const nameBits = normalizeNameBits({
    firstName: musicianDoc.firstName ?? leadBits.firstName ?? row.firstName,
    lastName:  musicianDoc.lastName  ?? leadBits.lastName  ?? row.lastName,
    displayName: musicianDoc.displayName ?? leadBits.displayName,
    vocalistDisplayName:
      leadBits.vocalistDisplayName ?? row.vocalistName ?? musicianDoc.vocalistDisplayName
  });

  const photoUrl =
    leadBits.photoUrl || musicianDoc.photoUrl || row.photoUrl || null;
  const profileUrl =
    leadBits.profileUrl || musicianDoc.profileUrl || row.profileUrl || '';

  return {
    musicianId: id || null,
    ...nameBits,
    photoUrl,
    profileUrl,
    isDeputy: !!row.isDeputy,
    phone: row.phone || musicianDoc.phone || null,
    setAt: row.updatedAt || new Date().toISOString(),
    available: row.reply === 'yes',
    slotIndex: typeof row.slotIndex === 'number' ? row.slotIndex : null,
  };
}

const SMS_FALLBACK_LOCK = new Set(); // key: WA MessageSid; prevents duplicate SMS fallbacks
const normCountyKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "_");

function classifyReply(text) {
  console.log(
    `🟢 (availabilityController.js) classifyReply  START at ${new Date().toISOString()}`,
    {
      actId: req.query?.actId,
      dateISO: req.query?.dateISO,
    }
  );
  const v = String(text || "")
    .trim()
    .toLowerCase();

  if (!v) return null;

  // YES variants
  if (
    /^(yes|y|yeah|yep|sure|ok|okay)$/i.test(v) ||
    /\bi am available\b/i.test(v) ||
    /\bi'm available\b/i.test(v) ||
    /\bavailable\b/i.test(v)
  )
    return "yes";

  // NO variants
  if (
    /^(no|n|nope|nah)$/i.test(v) ||
    /\bi am not available\b/i.test(v) ||
    /\bi'm not available\b/i.test(v) ||
    /\bunavailable\b/i.test(v)
  )
    return "no";

  return null;
}
const toE164 = (raw = "") => {
  let s = String(raw || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};

const normalize44 = (raw='') =>
  String(raw).replace(/\s+/g, '').replace(/^(\+44|44|0)/, '+44');

/* ========================================================================== */
/* 👤 findCanonicalMusicianByPhone                                            */
/* ========================================================================== */
export async function findCanonicalMusicianByPhone(phoneLike) {
  if (!phoneLike) return null;
  const p = normalize44(phoneLike);

  console.log("🔎 [findCanonicalMusicianByPhone] Lookup by phone", { phoneLike, normalized: p });

  const mus = await Musician.findOne({
    $or: [
      { phoneNormalized: p },
      { phone: p },
      { phoneNumber: p },
      { "contact.phone": p },
      { whatsappNumber: p },
    ],
  })
    .select(
      "_id firstName lastName email profilePicture musicianProfileImage profileImage photoUrl imageUrl phoneNormalized"
    )
    .lean();

  if (!mus) {
    console.log("ℹ️ [findCanonicalMusicianByPhone] No canonical musician found");
    return null;
  }

  // ── name helpers (drop these in once, before any usage of firstLast) ───────────
const firstLast = (nameLike) => {
  const s = (nameLike ?? "").toString().trim();
  if (!s) return { first: "", last: "", firstName: "", lastName: "", displayName: "" };
  const parts = s.split(/\s+/);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return { first, last, firstName: first, lastName: last, displayName: s };
};



  const names = firstLast(mus);
  const displayName = displayNameOf(mus);
  const profileUrl = buildProfileUrl(mus?._id);
  const photoUrl = pickPic(mus);

  console.log("✅ [findCanonicalMusicianByPhone] Canonical found", {
    ...names,
    displayName,
    vocalistDisplayName: displayName,
    profileUrl,
    photoUrl,
    isDeputy: mus?.isDeputy ?? undefined,
    email: mus?.email || "",
    phoneNormalized: mus?.phoneNormalized || "",
    _id: String(mus?._id || ""),
  });

  return mus;
}

function pickPic(mus) {
  const url =
    mus?.profilePicture ||
    mus?.musicianProfileImage ||
    mus?.profileImage ||
    mus?.photoUrl ||
    mus?.imageUrl ||
    "";
  return (typeof url === "string" && url.trim().startsWith("http")) ? url.trim() : "";
}

/**
 * Compute a member's total fee (base + travel) given act, member, and address.
 */
export async function computeFinalFeeForMember(act, member, address, dateISO, lineup) {
  const baseFee = Number(member?.fee ?? 0);
  const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
  const membersCount = Math.max(
    1,
    Array.isArray(lineup?.bandMembers) ? lineup.bandMembers.length : 1
  );

  const perHead =
    lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
  const base = baseFee > 0 ? baseFee : perHead;

  const { county: selectedCounty } = countyFromAddress(address);
  let travelFee = 0;
  let usedCountyRate = false;

  if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
    const raw = getCountyFeeValue(act.countyFees, selectedCounty);
    const val = Number(raw);
    if (Number.isFinite(val) && val > 0) {
      usedCountyRate = true;
      travelFee = Math.ceil(val);
    }
  }

  if (!usedCountyRate) {
    travelFee = await computeMemberTravelFee({
      act,
      member,
      selectedCounty,
      selectedAddress: address,
      selectedDate: dateISO,
    });
    travelFee = Math.max(0, Math.ceil(Number(travelFee || 0)));
  }

  return Math.max(0, Math.ceil(Number(base || 0) + Number(travelFee || 0)));
}

/**
 * Returns a friendly "Tuesday, 22nd March 2027" date string
 */
export function formatNiceDate(dateISO) {
  const dateObj = new Date(dateISO);
  const day = dateObj.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";
  const weekday = dateObj.toLocaleString("en-GB", { weekday: "long" });
  const month = dateObj.toLocaleString("en-GB", { month: "long" });
  const year = dateObj.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
}

/**
 * Send a client-facing email about act availability.
 * Falls back to hello@thesupremecollective.co.uk if no client email found.
 */
// ───────────────────────────────────────────────────────────────────────────────
// sendClientEmail — with identity and URL logging
// ───────────────────────────────────────────────────────────────────────────────
export async function sendClientEmail({ actId, to, name, subject, html }) {
  console.log("✉️ sendClientEmail START", { actId, to, name, subject });

  try {
    const act = await Act.findById(actId).lean();

    const recipient =
      (to && to !== "hello@thesupremecollective.co.uk")
        ? to
        : (act?.contactEmail &&
           act.contactEmail !== "hello@thesupremecollective.co.uk")
        ? act.contactEmail
        : process.env.NOTIFY_EMAIL || "hello@thesupremecollective.co.uk";

    console.log("📨 sendClientEmail recipient decision", {
      requestedTo: to,
      actContactEmail: act?.contactEmail,
      finalRecipient: recipient,
    });

    if (!recipient || recipient === "hello@thesupremecollective.co.uk") {
      console.warn("⚠️ No valid client recipient found, skipping sendEmail");
      return { success: false, skipped: true };
    }

    await sendEmail(recipient, subject, html, "hello@thesupremecollective.co.uk");

    console.log("✅ sendClientEmail OK", {
      actName: act?.tscName || act?.name,
      recipient,
      subject,
    });
    return { success: true };
  } catch (err) {
    console.error("❌ sendClientEmail failed:", err.message);
    return { success: false, error: err.message };
  }
}

function parsePayload(payload = "") {
  console.log(
    `🟢 (availabilityController.js) parsePayload START at ${new Date().toISOString()}`,
    {}
  );
  // Trim, uppercase, and match "YES<id>" / "NOLOC<id>" / "UNAVAILABLE<id>"
  const match = payload
    .trim()
    .match(/^(YES|NOLOC|UNAVAILABLE)([A-Za-z0-9]+)?$/i);
  if (!match) return { reply: null, enquiryId: null };
  return {
    reply: match[1].toLowerCase(),
    enquiryId: match[2] || null,
  };
}
const normalizeFrom = (from) => {
  console.log(
    `🟢 (availabilityController.js) normalizeFrom START at ${new Date().toISOString()}`,
    {}
  );
  const v = String(from || "")
    .replace(/^whatsapp:/i, "")
    .trim();
  if (!v) return [];
  const plus = v.startsWith("+") ? v : v.startsWith("44") ? `+${v}` : v;
  const uk07 = plus.replace(/^\+44/, "0");
  const ukNoPlus = plus.replace(/^\+/, "");
  return Array.from(new Set([plus, uk07, ukNoPlus]));
};
// Module-scope E.164 normalizer (also strips "whatsapp:" prefix)
const normalizeToE164 = (raw = "") => {

  let s = String(raw || "")
    .trim()
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};
/* ========================================================================== */
/* 💷 getCountyFeeValue                                                        */
/* ========================================================================== */
export function getCountyFeeValue(countyFees, countyName) {
  console.log("🟢 [getCountyFeeValue] START", {
    at: new Date().toISOString(),
    hasFees: !!countyFees,
    countyName,
  });
  if (!countyFees || !countyName) return undefined;

  const want = normCountyKey(countyName);

  // Map
  if (typeof countyFees.get === "function") {
    for (const [k, v] of countyFees) {
      if (normCountyKey(k) === want) {
        console.log("✅ [getCountyFeeValue] Match (Map)", { key: k, value: v });
        return v;
      }
    }
    return undefined;
  }

  // Object fast paths
  if (countyFees[countyName] != null) return countyFees[countyName];
  if (countyFees[want] != null) return countyFees[want];
  const spaced = countyName.replace(/_/g, " ");
  if (countyFees[spaced] != null) return countyFees[spaced];

  // Case-insensitive scan
  for (const [k, v] of Object.entries(countyFees)) {
    if (normCountyKey(k) === want) {
      console.log("✅ [getCountyFeeValue] Match (scan)", { key: k, value: v });
      return v;
    }
  }
  console.log("ℹ️ [getCountyFeeValue] No match");
  return undefined;
}


const _waFallbackSent = new Set(); // remember WA SIDs we've already fallen back for

// Normalise first-name display so we never fall back to "there" when we actually have a name
const safeFirst = (s) => {
  console.log(
    `🟢 (availabilityController.js) safeFirst START at ${new Date().toISOString()}`
  );
  const v = String(s || "").trim();
  return v ? v.split(/\s+/)[0] : "there";
};

function extractOutcode(address = "") {
  console.log(
    `🟢 (availabilityController.js) extractOutcode  START at ${new Date().toISOString()}`,
    {}
  );
  // Typical UK outcode patterns e.g. SL6, W1, SW1A, B23
  const s = String(address || "").toUpperCase();
  // Prefer the first token that looks like a postcode piece
  // Full PC can be "SL6 8HN". Outcode is "SL6".
  const m = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/); // full PC
  if (m) return m[1];
  const o = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/); // fallback: any outcode-like token
  return o ? o[1] : "";
}


/* ========================================================================== */
/* 🗺️ countyFromAddress                                                       */
/* ========================================================================== */
export function countyFromAddress(address = "") {
  console.log("🟢 [countyFromAddress] START", {
    at: new Date().toISOString(),
    addressSample: String(address).slice(0, 140),
  });

  const outcode = (extractOutcode(address) || "").toUpperCase();
  if (!outcode) {
    console.warn("⚠️ [countyFromAddress] No outcode extracted");
    return { outcode: "", county: "" };
  }

  const table = Array.isArray(postcodes) ? postcodes[0] || {} : postcodes || {};
  let found = "";

  for (const [countyKey, list] of Object.entries(table)) {
    if (Array.isArray(list) && list.includes(outcode)) {
      found = countyKey.replace(/_/g, " ").trim();
      break;
    }
  }

  console.log("✅ [countyFromAddress] Resolved", { outcode, county: found });
  return { outcode, county: found };
}

// Return obj.profilePicture if it is a valid http(s) URL string; otherwise, empty string
const getPictureUrlFrom = (obj = {}) => {
  console.log(
    `🟢 (availabilityController.js) getPictureUrlFrom START at ${new Date().toISOString()}`,
    {}
  );
  if (
    typeof obj.profilePicture === "string" &&
    obj.profilePicture.trim().startsWith("http")
  ) {
    return obj.profilePicture;
  }
  return "";
};


// controllers/notifyDeputies.js
export async function notifyDeputies({
  actId,
  lineupId,
  dateISO,
  formattedAddress,
  clientName,
  clientEmail,
  slotIndex = null,
  skipDuplicateCheck = false,
  skipIfUnavailable = true, // currently unused in this snippet
}) {
  console.log("📢 [notifyDeputies] START", {
    actId,
    lineupId,
    dateISO,
    formattedAddress,
    clientName,
    clientEmail,
    slotIndex,
    skipDuplicateCheck,
  });

  const normalizePhone = (raw = "") => {
    let v = String(raw || "").replace(/\s+/g, "").replace(/^whatsapp:/i, "");
    if (!v) return "";
    if (v.startsWith("+")) return v;
    if (v.startsWith("07")) return v.replace(/^0/, "+44");
    if (v.startsWith("44")) return `+${v}`;
    return v;
  };

  const firstLast = (o = {}) => {
    const s = String(o?.name || "").trim();
    const fn = String(o?.firstName || (s ? s.split(/\s+/)[0] : "") || "").trim();
    const ln = String(o?.lastName || (s && s.includes(" ") ? s.split(/\s+/).slice(1).join(" ") : "") || "").trim();
    return { firstName: fn, lastName: ln };
  };

  const displayNameOf = (p = {}) => {
    const fn = (p.firstName || p.name || "").trim();
    const ln = (p.lastName || "").trim();
    return (fn && ln) ? `${fn} ${ln}` : fn || ln || "";
  };

  const pickPic = (m = {}) =>
    m.photoUrl ||
    m.imageUrl ||
    m.profilePicture ||
    m.musicianProfileImage ||
    m.profileImage ||
    null;

  const buildProfileUrl = (id) => {
    const base = (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");
    return id ? `${base}/musician/${id}` : "";
  };

  const act = await Act.findById(actId).lean();
  if (!act) return console.warn("⚠️ [notifyDeputies] No act found");

  const lineup =
    act?.lineups?.find((l) => String(l._id) === String(lineupId)) ||
    act?.lineups?.find((l) => String(l.lineupId) === String(lineupId)) ||
    null;
  if (!lineup) return console.warn("⚠️ [notifyDeputies] No lineup found");

  const vocalists =
    lineup.bandMembers?.filter((m) =>
      ["vocal", "vocalist"].some((v) =>
        (m.instrument || "").toLowerCase().includes(v)
      )
    ) || [];

  if (!vocalists.length) {
    console.warn("⚠️ [notifyDeputies] No vocalists in lineup");
    return;
  }

  const targetVocalists =
    slotIndex !== null && vocalists[slotIndex] ? [vocalists[slotIndex]] : vocalists;

  console.log("🎯 [notifyDeputies] Target vocalists", {
    count: targetVocalists.length,
    slotIndex,
  });

  // Try to inherit fee from a lead who is not unavailable/no
  let inheritedFee = null;
  try {
    const leadAvailability = await AvailabilityModel.findOne({
      actId,
      dateISO,
      isDeputy: { $ne: true },
      ...(slotIndex !== null ? { slotIndex } : {}),
      reply: { $nin: ["unavailable", "no"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (leadAvailability?.fee) {
      inheritedFee = Number(leadAvailability.fee);
      console.log("💾 [notifyDeputies] Using lead fee", { inheritedFee });
    }
  } catch (err) {
    console.warn("⚠️ [notifyDeputies] Lead fee lookup failed:", err?.message);
  }

  if (!inheritedFee && targetVocalists[0]?.fee) {
    inheritedFee = Number(targetVocalists[0].fee);
    console.log("💾 [notifyDeputies] Fallback fee from act data", { inheritedFee });
  }

  // Build exclusion set (already YES/unavailable)
  const existingPhonesAgg = await AvailabilityModel.aggregate([
    { $match: { actId, dateISO, reply: { $in: ["yes", "unavailable"] } } },
    { $group: { _id: "$phone" } },
  ]);
  const existingSet = new Set(existingPhonesAgg.map((p) => (p._id || "").replace(/\s+/g, "")));

  let totalSent = 0;

  for (const vocalist of targetVocalists) {
    const vocalistNames = firstLast(vocalist);
    const vocalistDisplayName = displayNameOf(vocalist);

    for (const deputy of vocalist.deputies || []) {
      const cleanPhone = normalizePhone(deputy.phoneNumber || deputy.phone || "");
      if (!/^\+?\d{10,15}$/.test(cleanPhone)) continue;
      if (existingSet.has(cleanPhone)) continue;

      const deputyNames = firstLast(deputy);
      const deputyDisplayName = displayNameOf(deputy);

      console.log("🎯 [notifyDeputies] Triggering deputy", {
        isDeputy: true,
        deputy: {
          ...deputyNames,
          displayName: deputyDisplayName,
          profileUrl: buildProfileUrl(deputy?.musicianId || deputy?._id),
          photoUrl: pickPic(deputy),
          phone: cleanPhone,
          email: deputy?.email || "",
        },
        vocalist: {
          ...vocalistNames,
          vocalistDisplayName,
          profileUrl: buildProfileUrl(vocalist?.musicianId || vocalist?._id),
          photoUrl: pickPic(vocalist),
        },
        address: null,
        formattedAddress: formattedAddress || null,
        lineupId,
        slotIndex,
        inheritedFee,
      });

      await triggerAvailabilityRequest({
        actId,
        lineupId,
        dateISO,
        slotIndex,
        formattedAddress,

        clientName,
        clientEmail,

        isDeputy: true,
        selectedVocalistName: deputyDisplayName || vocalistDisplayName || "",
        vocalistName: vocalistDisplayName || "",

        deputy: {
          id: deputy.id || deputy.musicianId || deputy._id || null,
          musicianId: deputy.musicianId || deputy.id || deputy._id || null,
          firstName: deputy.firstName || deputy.name || "",
          lastName: deputy.lastName || "",
          phone: cleanPhone,
          email: deputy.email || "",
          imageUrl: deputy.imageUrl || deputy.photoUrl || pickPic(deputy) || null,
          displayName: deputyDisplayName || "",
        },

        inheritedFee,
        inheritedDuties: vocalist.instrument || "Vocalist",
        skipDuplicateCheck,
      });

      existingSet.add(cleanPhone);
      totalSent++;
      if (totalSent >= 3) {
        console.log("🛑 [notifyDeputies] Limit reached — contacted 3 deputies");
        return;
      }
    }
  }

  console.log("✅ [notifyDeputies] COMPLETE", { deputiesContacted: totalSent });
}

export async function triggerNextDeputy({
  actId,
  lineupId,
  dateISO,
  excludePhones = [],
  slotIndex = null, // 🆕 added for per-slot progression
}) {
  console.log("🎯 [triggerNextDeputy] START", { actId, dateISO, slotIndex });

  const act = await Act.findById(actId).lean();
  if (!act) return console.warn("⚠️ No act found for triggerNextDeputy");

  const lineup = act.lineups?.find((l) => String(l._id) === String(lineupId));
  if (!lineup)
    return console.warn("⚠️ No lineup found for triggerNextDeputy");

  // 🧩 Identify vocalists in this lineup
  const allVocalists =
    lineup.bandMembers?.filter((m) =>
      ["vocal", "vocalist"].some((v) =>
        (m.instrument || "").toLowerCase().includes(v)
      )
    ) || [];

  if (!allVocalists.length)
    return console.warn("⚠️ No vocalists found for triggerNextDeputy");

  // 🎤 Pick correct vocalist slot (default to 0 if unspecified)
  const vocalist =
    typeof slotIndex === "number"
      ? allVocalists[slotIndex] || allVocalists[0]
      : allVocalists[0];

  if (!vocalist)
    return console.warn("⚠️ No vocalist found for slotIndex", slotIndex);

  console.log(
    `🎤 Slot ${slotIndex}: evaluating deputies for ${vocalist.firstName || vocalist.name}`
  );

  // 🧹 Filter deputies that haven’t been contacted yet
  const remaining = (vocalist.deputies || []).filter((d) => {
    const phone = (d.phoneNumber || d.phone || "").replace(/\s+/g, "");
    return phone && !excludePhones.includes(phone);
  });

  if (!remaining.length) {
    console.log(
      `🚫 No remaining deputies to trigger for vocalist slot ${slotIndex}`
    );
    return;
  }

  const nextDeputy = remaining[0];
  console.log(
    `📨 Triggering next deputy for slot ${slotIndex}: ${nextDeputy.name}`
  );

  // 🧠 Notify this deputy only (pass along slotIndex)
  await notifyDeputies({
    actId,
    lineupId,
    dateISO,
    formattedAddress: "TBC",
    clientName: "Auto-triggered",
    clientEmail: "hello@thesupremecollective.co.uk",
    skipDuplicateCheck: true,
    skipIfUnavailable: false,
    customDeputyList: [nextDeputy],
    slotIndex, // 🆕 ensures deputies triggered for correct slot only
  });

  console.log(`✅ [triggerNextDeputy] Deputy triggered for slot ${slotIndex}`);
}



// === Booking-request wave (uses the SAME fee logic as enquiries) ===

// Compute a per-member final fee exactly like the enquiry flow:
// - explicit member.fee if set, else per-head from lineup.base_fee
// - plus county travel fee (if enabled) OR distance-based travel
async function _finalFeeForMember({
  act,
  lineup,
  members,
  member,
  address,
  dateISO,
}) {
  console.log(
    `🟢 (availabilityController.js) _finalFeeForMember START at ${new Date().toISOString()}`,
    {}
  );
  const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
  const membersCount = Math.max(1, Array.isArray(members) ? members.length : 1);
  const perHead = lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
  const base = Number(member?.fee ?? 0) > 0 ? Number(member.fee) : perHead;
// 🧩 If deputy fee missing, inherit from matching essential member (e.g. same instrument)
 if ((!member?.fee || Number(member.fee) === 0) && Array.isArray(lineup.bandMembers)) {
   const matching = lineup.bandMembers.find(
     m =>
       m.isEssential &&
       m.instrument &&
       member?.instrument &&
       m.instrument.toLowerCase() === member.instrument.toLowerCase()
   );
   if (matching?.fee) {
     console.log(`🎯 Inheriting fee £${matching.fee} from ${matching.instrument}`);
     base = Number(matching.fee);
   }
 }
  const { county: selectedCounty } = countyFromAddress(address);

  // County-rate (if enabled) wins; otherwise distance-based
  let travelFee = 0;
  let usedCounty = false;

  if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
    const raw = getCountyFeeValue(act.countyFees, selectedCounty);
    const val = Number(raw);
    if (Number.isFinite(val) && val > 0) {
      usedCounty = true;
      travelFee = Math.ceil(val);
    }
  }

  if (!usedCounty) {
    travelFee = await computeMemberTravelFee({
      act,
      member,
      selectedCounty,
      selectedAddress: address,
      selectedDate: dateISO,
    });
    travelFee = Math.max(0, Math.ceil(Number(travelFee || 0)));
  }

  return Math.max(0, Math.ceil(Number(base || 0) + Number(travelFee || 0)));
}

const isVocalRoleGlobal = (role = "") => {

  const r = String(role || "").toLowerCase();
  return [
    "lead male vocal",
    "lead female vocal",
    "lead vocal",
    "vocalist-guitarist",
    "vocalist-bassist",
    "mc/rapper",
    "lead male vocal/rapper",
    "lead female vocal/rapper",
    "lead male vocal/rapper & guitarist",
    "lead female vocal/rapper & guitarist",
  ].includes(r);
};

// --- New helpers for badge rebuilding ---



const normalizePhoneE164 = (raw = "") => {

  let v = String(raw || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

export const clearavailabilityBadges = async (req, res) => {
  console.log(
    `🟢 (availabilityController.js) cleadavailabilityBadges START at ${new Date().toISOString()}`,
    {}
  );
  try {
    const { actId } = req.body;
    if (!actId)
      return res.status(400).json({ success: false, message: "Missing actId" });

    await Act.findByIdAndUpdate(actId, {
      $set: { "availabilityBadges.active": false },
      $unset: {
        "availabilityBadges.vocalistName": "",
        "availabilityBadges.inPromo": "",
        "availabilityBadges.dateISO": "",
        "availabilityBadges.musicianId": "",
        "availabilityBadges.address": "",
        "availabilityBadges.setAt": "",
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ clearavailabilityBadges error", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
};

// -------------------- Utilities --------------------

const mapTwilioToEnquiryStatus = (s) => {
  console.log(
    `🟢  (availabilityController.js) mapTwilioToEnquiryStatus START at ${new Date().toISOString()}`,
    {}
  );
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

const BASE_URL = (
  process.env.BACKEND_PUBLIC_URL ||
  process.env.BACKEND_URL ||
  process.env.INTERNAL_BASE_URL ||
  "http://localhost:4000"
).replace(/\/$/, "");
const NORTHERN_COUNTIES = new Set([
  "ceredigion",
  "cheshire",
  "cleveland",
  "conway",
  "cumbria",
  "denbighshire",
  "derbyshire",
  "durham",
  "flintshire",
  "greater manchester",
  "gwynedd",
  "herefordshire",
  "lancashire",
  "leicestershire",
  "lincolnshire",
  "merseyside",
  "north humberside",
  "north yorkshire",
  "northumberland",
  "nottinghamshire",
  "rutland",
  "shropshire",
  "south humberside",
  "south yorkshire",
  "staffordshire",
  "tyne and wear",
  "warwickshire",
  "west midlands",
  "west yorkshire",
  "worcestershire",
  "wrexham",
  "rhondda cynon taf",
  "torfaen",
  "neath port talbot",
  "bridgend",
  "blaenau gwent",
  "caerphilly",
  "cardiff",
  "merthyr tydfil",
  "newport",
  "aberdeen city",
  "aberdeenshire",
  "angus",
  "argyll and bute",
  "clackmannanshire",
  "dumfries and galloway",
  "dundee city",
  "east ayrshire",
  "east dunbartonshire",
  "east lothian",
  "east renfrewshire",
  "edinburgh",
  "falkirk",
  "fife",
  "glasgow",
  "highland",
  "inverclyde",
  "midlothian",
  "moray",
  "na h eileanan siar",
  "north ayrshire",
  "north lanarkshire",
  "orkney islands",
  "perth and kinross",
  "renfrewshire",
  "scottish borders",
  "shetland islands",
  "south ayrshire",
  "south lanarkshire",
  "stirling",
  "west dunbartonshire",
  "west lothian",
]);

// Availability controller: robust travel fetch that supports both API shapes
const fetchTravel = async (origin, destination, dateISO) => {
  console.log(
    `🟢 (availabilityController.js) fetchTravel START at ${new Date().toISOString()}`,
    {}
  );
  const BASE = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.INTERNAL_BASE_URL ||
    "http://localhost:4000"
  ).replace(/\/+$/, "");

  const url =
    `${BASE}/api/v2/travel` +
    `?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&date=${encodeURIComponent(dateISO)}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) throw new Error(`travel http ${res.status}`);

  // --- Normalize shapes ---
  // Legacy: { rows:[{ elements:[{ distance, duration, fare? }] }] }
  const firstEl = data?.rows?.[0]?.elements?.[0];

  // Prefer new shape if present; otherwise build outbound from legacy element
  const outbound =
    data?.outbound ||
    (firstEl?.distance && firstEl?.duration
      ? {
          distance: firstEl.distance,
          duration: firstEl.duration,
          fare: firstEl.fare,
        }
      : undefined);

  // returnTrip only exists in the new shape
  const returnTrip = data?.returnTrip;

  // Return normalized plus raw for callers that need details
  return { outbound, returnTrip, raw: data };
};

const computeMemberTravelFee = async ({
  act,
  member,
  selectedCounty,
  selectedAddress,
  selectedDate,
}) => {
  console.log(
    `🟢 (availabilityController.js) computeMemberTravelFee START at ${new Date().toISOString()}`,
    { selectedCounty, selectedAddress, memberName: member?.firstName }
  );

  // 🧭 1️⃣ Determine origin (musician postcode)
  const origin =
    member?.postCode ||
    member?.postcode ||
    member?.post_code ||
    member?.addressPostcode ||
    "";

  // 🧭 2️⃣ Determine destination (event address)
  let destination = "";
  if (typeof selectedAddress === "string" && selectedAddress.trim() !== "") {
    destination = selectedAddress.trim();
  } else if (typeof selectedAddress === "object") {
    destination =
      selectedAddress?.postcode ||
      selectedAddress?.address ||
      selectedAddress?.formattedAddress ||
      "";
  } else {
    destination =
      act?.formattedAddress ||
      act?.venueAddress ||
      act?.eventAddress ||
      "";
  }

  // 🧭 3️⃣ Clean & normalize
  const cleanOrigin = origin?.trim()?.toUpperCase() || "";
  const cleanDestination = destination?.trim() || "";

  // 🧩 4️⃣ Guard against missing data
  if (!cleanOrigin || !cleanDestination || cleanDestination === "TBC") {
    console.warn("⚠️ computeMemberTravelFee missing valid origin or destination", {
      origin: cleanOrigin || "(none)",
      destination: cleanDestination || "(none)",
    });
    return 0;
  }

  // 🧩 5️⃣ Branch 1 — County fee per member
  if (act.useCountyTravelFee && act.countyFees) {
    const key = String(selectedCounty || "").toLowerCase();
    const feePerMember =
      Number(act.countyFees?.[key] ?? act.countyFees?.get?.(key) ?? 0) || 0;
    console.log(`📍 County-based travel fee (${key}): £${feePerMember}`);
    return feePerMember;
  }

  // 🧩 6️⃣ Branch 2 — Cost-per-mile
  if (Number(act.costPerMile) > 0) {
    try {
      const data = await fetchTravel(cleanOrigin, cleanDestination, selectedDate);
      const distanceMeters = data?.outbound?.distance?.value || 0;
      const distanceMiles = distanceMeters / 1609.34;
      const fee = distanceMiles * Number(act.costPerMile) * 25; // per-member multiplier
      console.log(
        `🚗 Cost-per-mile travel: ${distanceMiles.toFixed(1)}mi @ £${act.costPerMile}/mi → £${fee.toFixed(2)}`
      );
      return fee;
    } catch (err) {
      console.warn("⚠️ Cost-per-mile fetchTravel failed:", err.message);
      return 0;
    }
  }

  // 🧩 7️⃣ Branch 3 — MU-style calculation
  try {
    const data = await fetchTravel(cleanOrigin, cleanDestination, selectedDate);
    const outbound = data?.outbound;
    const returnTrip = data?.returnTrip;

    if (!outbound || !returnTrip) {
      console.warn("⚠️ MU-style: Missing outbound/return trip data", {
        origin: cleanOrigin,
        destination: cleanDestination,
      });
      return 0;
    }

    const totalDistanceMiles =
      (outbound.distance.value + returnTrip.distance.value) / 1609.34;
    const totalDurationHours =
      (outbound.duration.value + returnTrip.duration.value) / 3600;

    const fuelFee = totalDistanceMiles * 0.56; // MU mileage
    const timeFee = totalDurationHours * 13.23; // MU hourly rate
    const lateFee = returnTrip.duration.value / 3600 > 1 ? 136 : 0;
    const tollFee = (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);

    const total = fuelFee + timeFee + lateFee + tollFee;

    console.log(
      `🎶 MU-style travel fee: distance=${totalDistanceMiles.toFixed(
        1
      )}mi, hours=${totalDurationHours.toFixed(2)}, total=£${total.toFixed(2)}`
    );

    return total;
  } catch (err) {
    console.error("❌ MU-style computeMemberTravelFee failed:", err.message);
    return 0;
  }
};


const PUBLIC_SITE_BASE = (
  process.env.PUBLIC_SITE_URL ||
  process.env.FRONTEND_URL ||
  "http://localhost:5174"
).replace(/\/$/, "");

const buildProfileUrl = (id) =>
  id ? `${PUBLIC_SITE_BASE}/musician/${id}` : "";


const displayNameOf = (p = {}) => {
  const fn = (p.firstName || p.name || "").trim();
  const ln = (p.lastName || "").trim();
  return (fn && ln) ? `${fn} ${ln}` : fn || ln || "";
};


// 🆕 When you need structured pieces for templates/variables
export const nameBitsOf = (x = {}, { log = true, label = "nameBitsOf" } = {}) => {
  const firstName = (x.firstName || x.first || "").toString().trim();
  const lastName  = (x.lastName  || x.last  || "").toString().trim();
  const displayName = (
    x.displayName ||
    x.vocalistDisplayName ||
    x.selectedVocalistName ||
    x.vocalistName ||
    x.musicianName ||
    [firstName, lastName].filter(Boolean).join(" ")
  ).toString().trim();
  const vocalistDisplayName = (
    x.vocalistDisplayName ||
    x.selectedVocalistName ||
    x.vocalistName ||
    displayName
  ).toString().trim();

  const bits = { firstName, lastName, displayName, vocalistDisplayName };
  if (log && typeof logIdentity === "function") logIdentity(label, bits);
  return bits;
};

const firstLast = (p = {}) => ({
  firstName: (p.firstName || p.name || "").trim() || undefined,
  lastName: (p.lastName || "").trim() || undefined,
});


/* ========================================================================== */
/* 🎤 findVocalistPhone                                                        */
/* ========================================================================== */
export function findVocalistPhone(actData, lineupId) {
  console.log(
    "🐠 [findVocalistPhone] START",
    {
      at: new Date().toISOString(),
      lineupId,
      totalLineups: actData?.lineups?.length || 0,
      actName: actData?.tscName || actData?.name || "",
    }
  );

  if (!actData?.lineups?.length) {
    console.warn("⚠️ [findVocalistPhone] No lineups on act");
    return null;
  }

  const lineup = lineupId
    ? actData.lineups.find((l) => String(l._id || l.lineupId) === String(lineupId))
    : actData.lineups[0];

  if (!lineup?.bandMembers?.length) {
    console.warn("⚠️ [findVocalistPhone] Lineup has no bandMembers");
    return null;
  }

  // Lead (or first) vocalist
  const vocalist = lineup.bandMembers.find((m) =>
    String(m.instrument || "").toLowerCase().includes("vocal")
  );

  if (!vocalist) {
    console.warn("⚠️ [findVocalistPhone] No vocalist found in lineup", { lineupId });
    return null;
  }

  let phone =
    vocalist.phoneNormalized ||
    vocalist.phoneNumber ||
    vocalist.phone ||
    "";

  // If lead has no phone, try a deputy’s
  if (!phone && Array.isArray(vocalist.deputies) && vocalist.deputies.length) {
    const deputyWithPhone = vocalist.deputies.find(
      (d) => d.phoneNormalized || d.phoneNumber || d.phone
    );
    if (deputyWithPhone) {
      phone =
        deputyWithPhone.phoneNormalized ||
        deputyWithPhone.phoneNumber ||
        deputyWithPhone.phone ||
        "";
      console.log("🎯 [findVocalistPhone] Using deputy phone", {
        deputyFirstName: deputyWithPhone.firstName || deputyWithPhone.name || "",
        deputyLastName: deputyWithPhone.lastName || "",
        forVocalist: displayNameOf(vocalist),
      });
    }
  }

  // Normalize (expects your existing helper)
  phone = toE164(phone);

  if (!phone) {
    console.warn("⚠️ [findVocalistPhone] No valid phone for vocalist/deputies", {
      vocalistFirstName: vocalist.firstName || "",
      vocalistLastName: vocalist.lastName || "",
      lineup: lineup.actSize,
      act: actData.tscName || actData.name,
    });
    return null;
  }

  const vNames = firstLast(vocalist);
  const vDisplayName = displayNameOf(vocalist);

  console.log("🎤 [findVocalistPhone] Lead vocalist resolved", {
    ...vNames,
    displayName: vDisplayName,
    vocalistDisplayName: vDisplayName,
    instrument: vocalist.instrument,
    fee: vocalist.fee,
    // These are unknown in this function; include as nulls for consistency
    address: null,
    formattedAddress: null,
    profileUrl: buildProfileUrl(vocalist?.musicianId || vocalist?._id),
    photoUrl: pickPic(vocalist),
    isDeputy: false,
    phone,
    lineupSize: lineup?.actSize || "",
  });

  return { vocalist, phone };
}

async function getDeputyDisplayBits(dep) {
  const PUBLIC_SITE_BASE = (
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5174"
  ).replace(/\/$/, "");

  console.log("🔍 getDeputyDisplayBits START", {
    incomingDep: {
      id: dep?._id,
      musicianId: dep?.musicianId,
      firstName: dep?.firstName,
      lastName: dep?.lastName,
      phone: dep?.phone,
      phoneNumber: dep?.phoneNumber,
      phoneNormalized: dep?.phoneNormalized,
      email: dep?.email || dep?.emailAddress,
    }
  });

  try {
    /* -------------------------------------------------------------- */
    /* 🟣 1. INITIAL ID + DIRECT PICTURE CHECK                         */
    /* -------------------------------------------------------------- */
    const initialMusicianId =
      (dep?.musicianId && String(dep.musicianId)) ||
      (dep?._id && String(dep._id)) ||
      "";

      let resolvedMusicianId = initialMusicianId; // ⬅️ track locally; never mutate dep

    let photoUrl = getPictureUrlFrom(dep);
    console.log("📸 Step 1: Direct deputy picture →", photoUrl || "❌ none");

    let mus = null;

    /* -------------------------------------------------------------- */
    /* 🔵 2. Lookup by musicianId                                      */
    /* -------------------------------------------------------------- */
    if ((!photoUrl || !photoUrl.startsWith("http")) && initialMusicianId) {
      console.log("🆔 Step 2: Looking up musician by ID →", initialMusicianId);
      mus = await Musician.findById(initialMusicianId)
        .select(
          "musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl email phoneNormalized phone phoneNumber"
        )
        .lean();

      if (mus) {
  photoUrl = getPictureUrlFrom(mus);
  resolvedMusicianId = String(mus._id || initialMusicianId);
  console.log("📸 Step 2 result: From musicianId →", photoUrl || "❌ none");
} else {
  console.warn("⚠️ Step 2: No musician found by ID", initialMusicianId);
}
    }

    /* -------------------------------------------------------------- */
    /* 🟡 2.5 Lookup by phone if no photo yet                          */
    /* -------------------------------------------------------------- */
    if ((!photoUrl || !photoUrl.startsWith("http"))) {
      const possiblePhone =
        dep.phoneNormalized ||
        dep.phoneNumber ||
        dep.phone ||
        mus?.phoneNormalized ||
        mus?.phone ||
        mus?.phoneNumber;

      if (possiblePhone) {
        const normalizedPhone = possiblePhone
          .replace(/\s+/g, "")
          .replace(/^(\+44|44|0)/, "+44");

        console.log("📞 Step 2.5: Looking up by phone →", normalizedPhone);

        const musByPhone = await Musician.findOne({
          $or: [
            { phoneNormalized: normalizedPhone },
            { phone: normalizedPhone },
            { phoneNumber: normalizedPhone },
          ],
        })
          .select(
            "musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl email phoneNormalized _id"
          )
          .lean();

        if (musByPhone) {
          mus = musByPhone;
          resolvedMusicianId = String(musByPhone._id || resolvedMusicianId);
          photoUrl = getPictureUrlFrom(musByPhone);
          console.log("📸 Step 2.5 result: Found by phone →", photoUrl || "❌ none");

        } else {
          console.warn("⚠️ Step 2.5: No musician found by phone", normalizedPhone);
        }
      } else {
        console.log("ℹ️ Step 2.5 skipped — no phone available");
      }
    }

    /* -------------------------------------------------------------- */
    /* 🟤 3. Lookup by email                                           */
    /* -------------------------------------------------------------- */
    let resolvedEmail =
      dep?.email ||
      dep?.emailAddress ||
      mus?.email ||
      "";

    if ((!photoUrl || !photoUrl.startsWith("http")) && resolvedEmail) {
      console.log("📧 Step 3: Lookup by email →", resolvedEmail);

      const musByEmail = await Musician.findOne({ email: resolvedEmail })
        .select(
          "musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl _id email"
        )
        .lean();

      if (musByEmail) {
        mus = musByEmail;
        resolvedMusicianId = String(musByEmail._id || resolvedMusicianId);
        photoUrl = getPictureUrlFrom(musByEmail);
        resolvedEmail = musByEmail.email;
        console.log("📸 Step 3 result: Found by email →", photoUrl || "❌ none");

      
      } else {
        console.warn("⚠️ Step 3: No musician found for email", resolvedEmail);
      }
    }

    /* -------------------------------------------------------------- */
    /* 🟢 FINAL RESOLUTION                                            */
    /* -------------------------------------------------------------- */
const finalMusicianId = String(
  resolvedMusicianId || dep?.musicianId || initialMusicianId || ""
);

const profileUrl = finalMusicianId
  ? `${PUBLIC_SITE_BASE}/musician/${finalMusicianId}`
  : "";

    const FALLBACK_PHOTO =
      "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1761313694/profile_placeholder_rcdly4.png";

    if (!photoUrl || !photoUrl.startsWith("http")) {
      console.log("🪄 No valid photo found — using fallback");
      photoUrl = FALLBACK_PHOTO;
    }

    const finalBits = {
      musicianId: finalMusicianId,
      photoUrl,
      profileUrl,
      resolvedEmail,
      
    };

    // ⭐ Add name fields for badge + toasts
if (mus) {
  finalBits.firstName = mus.firstName || "";
  finalBits.lastName = mus.lastName || "";
  finalBits.resolvedName = `${mus.firstName || ""} ${mus.lastName || ""}`.trim();
} else {
  // fallback if dep itself had name (vocalists do)
  finalBits.firstName = dep.firstName || "";
  finalBits.lastName = dep.lastName || "";
  finalBits.resolvedName = `${dep.firstName || ""} ${dep.lastName || ""}`.trim();
}

    console.log("🎯 FINAL getDeputyDisplayBits result:", finalBits);
    return finalBits;
  } catch (e) {
    console.warn("❌ getDeputyDisplayBits FAILED:", e.message || e);

    const fallbackId =
      (dep?.musicianId && String(dep.musicianId)) ||
      (dep?._id && String(dep._id)) ||
      "";

    const FALLBACK_PHOTO =
      "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1761313694/profile_placeholder_rcdly4.png";

    return {
      musicianId: fallbackId,
      photoUrl: FALLBACK_PHOTO,
      profileUrl: fallbackId
        ? `${PUBLIC_SITE_BASE}/musician/${fallbackId}`
        : "",
      resolvedEmail: dep?.email || "",
    };
  }
}


export const triggerAvailabilityRequest = async (reqOrArgs, maybeRes) => {
  const isExpress = !!maybeRes;
  const body = isExpress ? reqOrArgs.body : reqOrArgs;
  const res = isExpress ? maybeRes : null;

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────
  const makeShortId = () =>
    Math.random().toString(36).slice(2, 8).toUpperCase();

  const normalizeNameBits = (nameLike) => {
    const s = (nameLike ?? "").toString().trim();
    if (!s) return { first:"", last:"", firstName:"", lastName:"", displayName:"", vocalistDisplayName:"" };
    const parts = s.split(/\s+/);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    return {
      first, last,
      firstName: first, lastName: last,
      displayName: s,
      vocalistDisplayName: s,
    };
  };

  const displayNameOf = (p = {}) => {
    const fn = (p.firstName || p.name || "").trim();
    const ln = (p.lastName || "").trim();
    return (fn && ln) ? `${fn} ${ln}` : fn || ln || "";
  };

  const pickPic = (m = {}) =>
    m.photoUrl ||
    m.musicianProfileImageUpload ||
    m.profileImage ||
    m.imageUrl ||
    m.profilePicture ||
    m.musicianProfileImage ||
    null;

  const normalizePhone = (raw = "") => {
    let v = String(raw || "").replace(/\s+/g, "").replace(/^whatsapp:/i, "");
    if (!v) return "";
    if (v.startsWith("+")) return v;
    if (v.startsWith("07")) return v.replace(/^0/, "+44");
    if (v.startsWith("44")) return `+${v}`;
    return v;
  };

  const normalizeToE164 = (raw = "") => normalizePhone(raw); // alias

  try {
    const {
      actId,
      lineupId, // optional
      date,
      dateISO: dISO,
      address,
      formattedAddress,
      clientName,
      clientEmail,
      isDeputy = false,
      deputy = null,
      inheritedFee = null, // 🔹 optional
      skipDuplicateCheck = false,
      selectedVocalistName = "",
      vocalistName = "",
    } = body;

    const PUBLIC_SITE_BASE = (
      process.env.PUBLIC_SITE_URL ||
      process.env.FRONTEND_URL ||
      "http://localhost:5174"
    ).replace(/\/$/, "");

    /* -------------------------------------------------------------- */
    /* 🔢 Enquiry + slotIndex base                                    */
    /* -------------------------------------------------------------- */
    const enquiryId =
      body.enquiryId ||
      body.shortlistId ||
      body.requestId ||
      body.parentKey ||
      null;

    if (!enquiryId) {
      console.warn("⚠️ No enquiryId provided — slotIndex grouping may fail");
    }

    const existingForEnquiry = enquiryId
      ? await AvailabilityModel.find({ enquiryId }).lean()
      : [];

    const slotIndexBase = existingForEnquiry.length; // kept for reference
    const slotIndexFromBody =
      typeof body.slotIndex === "number" ? body.slotIndex : null;

    /* -------------------------------------------------------------- */
    /* 🧭 Enrich clientName/email                                     */
    /* -------------------------------------------------------------- */
    let resolvedClientName = clientName || "";
    let resolvedClientEmail = clientEmail || "";

    const userId =
      body?.userId || body?.user?._id || body?.user?.id || body?.userIdFromToken;

    if (!resolvedClientEmail && userId) {
      try {
        const userDoc = await userModel
          .findById(userId)
          .select("firstName surname email")
          .lean();

        if (userDoc) {
          resolvedClientName = `${userDoc.firstName || ""} ${userDoc.surname || ""}`.trim();
          resolvedClientEmail = userDoc.email || "";
          console.log(`📧 Enriched client details from userId: ${resolvedClientName} <${resolvedClientEmail}>`);
        }
      } catch (err) {
        console.warn("⚠️ Failed to enrich client from userId:", err.message);
      }
    }

    /* -------------------------------------------------------------- */
    /* 📅 Basic act + date resolution                                 */
    /* -------------------------------------------------------------- */
    const dateISO = dISO || (date ? new Date(date).toISOString().slice(0, 10) : null);
    if (!actId || !dateISO) throw new Error("Missing actId or dateISO");

    const act = await Act.findById(actId).lean();
    if (!act) throw new Error("Act not found");

    // derive addresses
    const fullFormattedAddress =
      formattedAddress || address || act?.formattedAddress || act?.venueAddress || "TBC";

    let shortAddress =
      (fullFormattedAddress || "TBC").split(",").slice(0, 2).join(", ").trim() || "TBC";

    const metaAddress = fullFormattedAddress || shortAddress || "TBC";

    const formattedDate = new Date(dateISO).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // 🔍 Entry summary
    console.log("🟣 [triggerAvailabilityRequest] ENTRY", {
      actId,
      lineupId,
      dateISO,
      isDeputy,
      selectedVocalistName,
      vocalistName,
      address: address || null,
      formattedAddress: formattedAddress || null,
      fullFormattedAddress,
      shortAddress,
      metaAddress,
      enquiryId,
      slotIndexFromBody,
    });

    /* -------------------------------------------------------------- */
    /* 🎵 Lineup + members                                            */
    /* -------------------------------------------------------------- */
    const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
    const lineup = lineupId
      ? lineups.find(
          (l) =>
            String(l._id) === String(lineupId) ||
            String(l.lineupId) === String(lineupId)
        )
      : lineups[0];

    if (!lineup) {
      console.warn("⚠️ No valid lineup found — defaulting to first available or skipping lineup-specific logic.");
    }

    const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];

    /* -------------------------------------------------------------- */
    /* 🔎 Address compare helpers                                     */
    /* -------------------------------------------------------------- */
    const normalizeAddr = (s = "") =>
      String(s || "")
        .toLowerCase()
        .replace(/\buk\b/g, "")
        .replace(/\s+/g, " ")
        .replace(/,\s*/g, ",")
        .trim();

    const lastTwoParts = (s = "") => normalizeAddr(s).split(",").slice(-2).join(",");

    const addressesRoughlyEqual = (a = "", b = "") => {
      if (!a || !b) return false;
      const A = normalizeAddr(a);
      const B = normalizeAddr(b);
      if (A === B) return true;
      const A2 = lastTwoParts(a);
      const B2 = lastTwoParts(b);
      return A2 && B2 && (A2 === B2 || A2.includes(B2) || B2.includes(A2));
    };

    /* -------------------------------------------------------------- */
    /* 💰 Fee calculation helper                                      */
    /* -------------------------------------------------------------- */
    const feeForMember = async (member) => {
      const baseFee = Number(member?.fee ?? 0);

      const essentialExtras = Array.isArray(member?.additionalRoles)
        ? member.additionalRoles
            .filter((r) => r?.isEssential && Number(r?.additionalFee) > 0)
            .reduce((sum, r) => sum + Number(r.additionalFee), 0)
        : 0;

      const { county: selectedCounty } = countyFromAddress(fullFormattedAddress);
      const selectedDate = dateISO;
      let travelFee = 0;
      let travelSource = "none";

      if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
        const raw = getCountyFeeValue(act.countyFees, selectedCounty);
        const val = Number(raw);
        if (Number.isFinite(val) && val > 0) {
          travelFee = Math.ceil(val);
          travelSource = "county";
        }
      }

      if (travelSource === "none") {
        const computed = await computeMemberTravelFee({
          act,
          member,
          selectedCounty,
          selectedAddress: fullFormattedAddress,
          selectedDate,
        });
        travelFee = Math.max(0, Math.ceil(Number(computed || 0)));
        travelSource = "computed";
      }

      const total = baseFee + essentialExtras + travelFee;
      return total;
    };

    /* -------------------------------------------------------------- */
    /* 🎤 MULTI-VOCALIST HANDLING (Lead only)                         */
    /* -------------------------------------------------------------- */
    const vocalists = members.filter((m) =>
      (m.instrument || "").toLowerCase().includes("vocal")
    );

    if (!isDeputy && vocalists.length > 1) {
      const results = [];

      for (let i = 0; i < vocalists.length; i++) {
        const vMember = vocalists[i];
        const slotIndexForThis = i;

        const phone = normalizePhone(vMember.phone || vMember.phoneNumber);
        if (!phone) {
          console.warn(`⚠️ Skipping vocalist ${vMember.firstName} — no phone number`);
          continue;
        }

        let enriched = { ...vMember };
        try {
          if (vMember?.musicianId) {
            const mus = await Musician.findById(vMember.musicianId).lean();
            if (mus) enriched = { ...mus, ...enriched };
          }
        } catch (err) {
          console.warn(`⚠️ Failed to enrich vocalist ${vMember.firstName}:`, err.message);
        }

        // 🧯 PRIOR-REPLY CHECK (per-slot)
        try {
          const prior = await AvailabilityModel.findOne({
            actId,
            dateISO,
            phone,
            v2: true,
            slotIndex: slotIndexForThis,
            reply: { $in: ["yes", "no", "unavailable"] },
          })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();

          if (prior && addressesRoughlyEqual(prior.formattedAddress || prior.address || "", fullFormattedAddress)) {
            console.log("ℹ️ Using existing reply (multi-vocalist) — skipping WA send", {
              slotIndex: slotIndexForThis,
              reply: prior.reply,
              phone,
            });

            if (prior.reply === "unavailable" || prior.reply === "no") {
              await notifyDeputies({
                actId,
                lineupId: lineup?._id || lineupId || null,
                dateISO,
                formattedAddress: fullFormattedAddress,
                clientName: resolvedClientName || "",
                clientEmail: resolvedClientEmail || "",
                slotIndex: slotIndexForThis,
                skipDuplicateCheck: true,
                skipIfUnavailable: false,
              });
            }

            if (prior.reply === "yes") {
              try {
                const badgeRes = await rebuildAndApplyAvailabilityBadge({
                  actId,
                  dateISO,
                  __fromExistingReply: true,
                });
                if (global.availabilityNotify && badgeRes?.badge) {
                  global.availabilityNotify.badgeUpdated({
                    type: "availability_badge_updated",
                    actId,
                    actName: act?.tscName || act?.name,
                    dateISO,
                    badge: badgeRes.badge,
                    isDeputy: false,
                  });
                }
              } catch (e) {
                console.warn("⚠️ Badge refresh (existing YES) failed:", e?.message || e);
              }
            }

            results.push({
              name: vMember.firstName,
              slotIndex: slotIndexForThis,
              phone,
              reusedExisting: true,
              existingReply: prior.reply,
            });
            continue;
          }
        } catch (e) {
          console.warn("⚠️ Prior-reply check (multi) failed:", e?.message || e);
        }

        const finalFee = await feeForMember(vMember);

        // Resolve a real musicianId if possible
        let musicianDoc = null;
        try {
          if (vMember.musicianId) {
            musicianDoc = await Musician.findById(vMember.musicianId).lean();
          }
          if (!musicianDoc) {
            const cleanPhone = phone;
            musicianDoc = await Musician.findOne({
              $or: [
                { phoneNormalized: cleanPhone },
                { phone: cleanPhone },
                { phoneNumber: cleanPhone },
              ],
            }).lean();
          }
        } catch (err) {
          console.warn("⚠️ Failed to fetch real musician:", err.message);
        }

        const realMusicianId =
          musicianDoc?._id || vMember.musicianId || vMember._id || null;

        const now = new Date();
        const query = { actId, dateISO, phone, slotIndex: slotIndexForThis };

        // 🔗 correlation id
        const requestId = makeShortId();

        const setOnInsert = {
          actId,
          lineupId: lineup?._id || null,
          dateISO,
          phone,
          v2: true,
          enquiryId,
          slotIndex: slotIndexForThis,
          createdAt: now,
          status: "sent",
          reply: null,
          requestId, // 🔗
        };

        const displayNameForLead = `${enriched.firstName || vMember.firstName || ""} ${enriched.lastName || vMember.lastName || ""}`.trim();

        const setAlways = {
          isDeputy: false,
          musicianId: realMusicianId,
          musicianName: displayNameForLead,
          musicianEmail: enriched.email || "",
          photoUrl: enriched.photoUrl || enriched.profilePicture || "",
          address: fullFormattedAddress,
          formattedAddress: fullFormattedAddress,
          formattedDate,
          clientName: resolvedClientName || "",
          clientEmail: resolvedClientEmail || "",
          actName: act?.tscName || act?.name || "",
          duties: vMember.instrument || "Vocalist",
          fee: String(finalFee),
          updatedAt: now,
          selectedVocalistName: displayNameForLead,
          selectedVocalistId: realMusicianId || null,
          vocalistName: displayNameForLead,
          profileUrl: realMusicianId ? `${PUBLIC_SITE_BASE}/musician/${realMusicianId}` : "",
          requestId, // 🔗 keep for visibility/queries
        };

        console.log("🔎 [triggerAvailabilityRequest/multi] PERSON", {
          role: "LEAD",
          firstName: (enriched.firstName || vMember.firstName || "").trim(),
          lastName: (enriched.lastName || vMember.lastName || "").trim(),
          selectedVocalistName: displayNameForLead,
          vocalistName: displayNameForLead,
          address: fullFormattedAddress,
          shortAddress,
          photoUrl: setAlways.photoUrl || "",
          profileUrl: setAlways.profileUrl || "",
          musicianId: realMusicianId || null,
          phone,
          slotIndex: slotIndexForThis,
          requestId,
        });

        const savedLead = await AvailabilityModel.findOneAndUpdate(
          query,
          { $setOnInsert: setOnInsert, $set: setAlways },
          { new: true, upsert: true }
        );

        console.log("✅ Upserted LEAD row", {
          slot: slotIndexForThis,
          isDeputy: savedLead?.isDeputy,
          musicianId: String(savedLead?.musicianId || ""),
          requestId,
        });

        // Build interactive buttons (carry requestId)
        const buttons = [
          { id: `YES:${requestId}`,         title: "Yes" },
          { id: `NO:${requestId}`,          title: "No" },
          { id: `UNAVAILABLE:${requestId}`, title: "Unavailable" },
        ];

        const nameBits = normalizeNameBits(displayNameOf(vMember));

        // Send interactive WA (no contentSid with interactive)
        const msg = await sendWhatsAppMessage({
          to: phone,
          actData: act,
          lineup: lineup || {},
          member: vMember,
          address: metaAddress,
          dateISO,
          role: vMember.instrument,
          variables: {
            firstName: nameBits.firstName || "Musician",
            date: formattedDate,
            location: shortAddress,
            fee: String(finalFee),
            role: vMember.instrument,
            actName: act.tscName || act.name,
          },
          requestId,   // 🔗
          buttons,     // 🔗
          // smsBody kept here as fallback text if you decide to send plain message in future
          smsBody: `Hi ${vMember.firstName || "there"}, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress} at a rate of £${finalFee} for ${vMember.instrument} duties with ${act.tscName || act.name}. Please indicate your availability 💫`,
        });

        // persist Twilio SID + requestId to the row
        try {
          await AvailabilityModel.updateOne(
            { _id: savedLead._id },
            { $set: { messageSidOut: msg?.sid || null, requestId } }
          );
        } catch (e) {
          console.warn("⚠️ Could not persist messageSidOut/requestId (multi):", e?.message || e);
        }

        results.push({ name: vMember.firstName, slotIndex: slotIndexForThis, phone, requestId, sid: msg?.sid || null });
      }

      console.log(`✅ Multi-vocalist availability triggered for:`, results);
      if (res) return res.json({ success: true, sent: results.length, details: results });
      return { success: true, sent: results.length, details: results };
    }

    /* -------------------------------------------------------------- */
    /* 🎤 SINGLE VOCALIST / DEPUTY PATH                               */
    /* -------------------------------------------------------------- */
    const targetMember = isDeputy
      ? deputy
      : findVocalistPhone(act, lineup?._id || lineupId)?.vocalist;

    if (!targetMember) throw new Error("No valid member found");

    let enrichedMember = { ...targetMember };
    try {
      if (targetMember?.musicianId) {
        const mus = await Musician.findById(targetMember.musicianId).lean();
        if (mus) enrichedMember = { ...mus, ...enrichedMember };
      } else {
        const cleanPhone = normalizePhone(targetMember.phone || targetMember.phoneNumber || "");
        if (cleanPhone) {
          const mus = await Musician.findOne({
            $or: [{ phoneNormalized: cleanPhone }, { phone: cleanPhone }],
          }).lean();
          if (mus) enrichedMember = { ...mus, ...enrichedMember };
        }
      }
    } catch (err) {
      console.warn("⚠️ Enrich failed:", err.message);
    }

    if (isDeputy && deputy?.id && !targetMember.musicianId) {
      targetMember.musicianId = deputy.id;
    }

    targetMember.email = enrichedMember.email || targetMember.email || null;
    targetMember.musicianId = enrichedMember._id || targetMember.musicianId || null;

    const phone = normalizePhone(targetMember.phone || targetMember.phoneNumber);
    if (!phone) throw new Error("Missing phone");

    // 🔎 Canonical musician from Musicians collection (by phone)
    const canonical = await findCanonicalMusicianByPhone(phone);

    // Prefer canonical-from-phone; fall back to any enriched/act ids
    const canonicalId = canonical?._id
      || enrichedMember?._id
      || targetMember?.musicianId
      || null;

    const canonicalName = canonical
      ? `${canonical.firstName || ''} ${canonical.lastName || ''}`.trim()
      : `${targetMember.firstName || ''} ${targetMember.lastName || ''}`.trim();

    const canonicalPhoto = pickPic(canonical) ||
      enrichedMember?.photoUrl ||
      enrichedMember?.profilePicture ||
      '';

    const selectedName = String(
      selectedVocalistName ||
      canonicalName ||
      `${targetMember?.firstName || ""} ${targetMember?.lastName || ""}`
    ).trim();

    /* -------------------------------------------------------------- */
    /* 🛡️ Prior-reply check (same date + same location)               */
    /* -------------------------------------------------------------- */
    const priorReplyQuery = {
      actId,
      dateISO,
      phone,
      v2: true,
      ...(isDeputy && slotIndexFromBody !== null ? { slotIndex: slotIndexFromBody } : {}),
      reply: { $in: ["yes", "no", "unavailable"] },
    };

    const prior = await AvailabilityModel.findOne(priorReplyQuery)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (prior && addressesRoughlyEqual(prior.formattedAddress || prior.address || "", fullFormattedAddress)) {
      console.log("ℹ️ Using existing reply (single path) — skipping WA send", {
        isDeputy,
        reply: prior.reply,
        phone,
      });

      if (prior.reply === "yes") {
        try {
          const badgeRes = await rebuildAndApplyAvailabilityBadge({
            actId,
            dateISO,
            __fromExistingReply: true,
          });
          if (global.availabilityNotify && badgeRes?.badge) {
            global.availabilityNotify.badgeUpdated({
              type: "availability_badge_updated",
              actId,
              actName: act?.tscName || act?.name,
              dateISO,
              badge: badgeRes.badge,
              isDeputy,
            });
          }
        } catch (e) {
          console.warn("⚠️ Badge refresh (existing YES) failed:", e?.message || e);
        }
      }

      if (!isDeputy && (prior.reply === "unavailable" || prior.reply === "no")) {
        await notifyDeputies({
          actId,
          lineupId: lineup?._id || lineupId || null,
          dateISO,
          formattedAddress: fullFormattedAddress,
          clientName: resolvedClientName || "",
          clientEmail: resolvedClientEmail || "",
          slotIndex: typeof body.slotIndex === "number" ? body.slotIndex : null,
          skipDuplicateCheck: true,
          skipIfUnavailable: false,
        });
      }

      if (res) return res.json({ success: true, sent: 0, usedExisting: prior.reply });
      return { success: true, sent: 0, usedExisting: prior.reply };
    }

    /* -------------------------------------------------------------- */
    /* 🔐 Refined duplicate guard                                     */
    /* -------------------------------------------------------------- */
    const strongGuardQuery = {
      actId,
      dateISO,
      phone,
      v2: true,
      ...(isDeputy && slotIndexFromBody !== null ? { slotIndex: slotIndexFromBody } : {}),
    };
    const existingAny = await AvailabilityModel.findOne(strongGuardQuery).lean();

    if (existingAny && !skipDuplicateCheck) {
      console.log("⚠️ Duplicate availability request detected — skipping WhatsApp send", strongGuardQuery);
      if (res) return res.json({ success: true, sent: 0, skipped: "duplicate-strong" });
      return { success: true, sent: 0, skipped: "duplicate-strong" };
    }

    /* -------------------------------------------------------------- */
    /* 🧮 Final Fee Logic (including deputy inheritedFee)             */
    /* -------------------------------------------------------------- */
    let finalFee;

    if (isDeputy && inheritedFee) {
      const parsed = parseFloat(String(inheritedFee).replace(/[^\d.]/g, "")) || 0;
      let inheritedTotal = parsed;

      if (inheritedTotal < 350) {
        console.log("🧭 Inherited fee seems base-only — adding travel component for deputy");

        const { county: selectedCounty } = countyFromAddress(fullFormattedAddress);
        const selectedDate = dateISO;

        let travelFee = 0;
        let travelSource = "none";

        if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
          const raw = getCountyFeeValue(act.countyFees, selectedCounty);
          const val = Number(raw);
          if (Number.isFinite(val) && val > 0) {
            travelFee = Math.ceil(val);
            travelSource = "county";
          }
        }

        if (travelSource === "none") {
          const computed = await computeMemberTravelFee({
            act,
            member: deputy,
            selectedCounty,
            selectedAddress: fullFormattedAddress,
            selectedDate,
          });
          travelFee = Math.max(0, Math.ceil(Number(computed || 0)));
          travelSource = "computed";
        }

        inheritedTotal += travelFee;
        console.log("💷 Deputy travel applied:", { travelFee, travelSource, inheritedTotal });
      }

      finalFee = Math.round(inheritedTotal);
      console.log(`🪙 Deputy inherited total (incl. travel): £${finalFee}`);
    } else {
      finalFee = await feeForMember(targetMember);
    }

    console.log("🐛 triggerAvailabilityRequest progress checkpoint", {
      actId,
      isDeputy,
      targetMember: targetMember?.firstName,
      phone: targetMember?.phone,
      finalFee,
    });

    /* -------------------------------------------------------------- */
    /* 🛡️ Skip if already replied unavailable / no                    */
    /* -------------------------------------------------------------- */
    const existing = await AvailabilityModel.findOne({
      actId,
      dateISO,
      phone,
      v2: true,
    }).lean();

    if (existing && !skipDuplicateCheck && ["unavailable", "no"].includes(existing.reply)) {
      console.log(
        "🚫 Skipping availability request — musician already marked unavailable/no reply",
        { actId, dateISO, phone: existing.phone, reply: existing.reply }
      );
      if (res) return res.json({ success: true, sent: 0, skipped: existing.reply });
      return { success: true, sent: 0, skipped: existing.reply };
    }

    if (existing && !skipDuplicateCheck && !isDeputy) {
      console.log("⚠️ Duplicate availability request detected — skipping WhatsApp send", { actId, dateISO, phone: existing.phone });
      if (res) return res.json({ success: true, sent: 0, skipped: "duplicate" });
      return { success: true, sent: 0, skipped: "duplicate" };
    }

    /* -------------------------------------------------------------- */
    /* ✅ Upsert availability record (single lead / deputy)           */
    /* -------------------------------------------------------------- */
    const singleSlotIndex =
      typeof body.slotIndex === "number" ? body.slotIndex : 0;

    const now = new Date();
    const query = { actId, dateISO, phone, slotIndex: singleSlotIndex };

    // 🔗 correlation id
    const requestId = makeShortId();

    const setOnInsert = {
      actId,
      lineupId: lineup?._id || null,
      dateISO,
      phone,
      v2: true,
      enquiryId,
      slotIndex: singleSlotIndex,
      createdAt: now,
      status: "sent",
      reply: null,
      musicianId: canonicalId,
      selectedVocalistName: selectedName,
      selectedVocalistId: canonicalId || null,
      requestId, // 🔗
    };

    const setAlways = {
      isDeputy: !!isDeputy,
      musicianName: canonicalName,
      musicianEmail: canonical?.email || targetMember.email || "",
      photoUrl: canonicalPhoto,
      address: fullFormattedAddress,
      formattedAddress: fullFormattedAddress,
      formattedDate,
      clientName: resolvedClientName || "",
      clientEmail: resolvedClientEmail || "",
      actName: act?.tscName || act?.name || "",
      duties: body?.inheritedDuties || targetMember.instrument || "Performance",
      fee: String(finalFee),
      updatedAt: now,
      profileUrl: canonicalId ? `${PUBLIC_SITE_BASE}/musician/${canonicalId}` : "",
      selectedVocalistName: selectedName,
      selectedVocalistId: canonicalId || null,
      vocalistName: vocalistName || selectedName || "",
      requestId, // 🔗
    };

    const resolvedFirstName = (canonical?.firstName || targetMember.firstName || enrichedMember.firstName || "").trim();
    const resolvedLastName  = (canonical?.lastName  || targetMember.lastName  || enrichedMember.lastName  || "").trim();
    console.log("🔎 [triggerAvailabilityRequest/single] PERSON", {
      role: isDeputy ? "DEPUTY" : "LEAD",
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      selectedVocalistName: setAlways.selectedVocalistName,
      vocalistName: setAlways.vocalistName,
      address: fullFormattedAddress,
      shortAddress,
      photoUrl: setAlways.photoUrl || "",
      profileUrl: setAlways.profileUrl || "",
      musicianId: canonicalId || null,
      phone,
      slotIndex: singleSlotIndex,
      requestId,
    });

    const saved = await AvailabilityModel.findOneAndUpdate(
      query,
      { $setOnInsert: setOnInsert, $set: setAlways },
      { new: true, upsert: true }
    );

    console.log(`✅ Upserted ${isDeputy ? "DEPUTY" : "LEAD"} row`, {
      slot: singleSlotIndex,
      isDeputy: saved?.isDeputy,
      musicianId: String(saved?.musicianId || ""),
      requestId,
    });

    /* -------------------------------------------------------------- */
    /* 💬 Send WhatsApp (interactive buttons with requestId)          */
    /* -------------------------------------------------------------- */
    const roleStr = body?.inheritedDuties || targetMember.instrument || "Performance";
    const feeStr = finalFee > 0 ? `£${finalFee}` : "TBC";

    const person = targetMember || {};
    const nameBits = normalizeNameBits(displayNameOf(person));

    console.log("📤 [WA SEND] Summary", {
      to: phone,
      role: roleStr,
      fee: feeStr,
      date: formattedDate,
      shortAddress,
      actName: act.tscName || act.name,
      isDeputy,
      selectedVocalistName: setAlways.selectedVocalistName,
      vocalistName: setAlways.vocalistName,
      photoUrl: setAlways.photoUrl,
      profileUrl: setAlways.profileUrl,
      requestId,
    });

    const buttons = [
      { id: `YES:${requestId}`,         title: "Yes" },
      { id: `NO:${requestId}`,          title: "No" },
      { id: `UNAVAILABLE:${requestId}`, title: "Unavailable" },
    ];

    const msg = await sendWhatsAppMessage({
      to: phone,
      actData: act,
      lineup: lineup || {},
      member: person,
      address: metaAddress,
      dateISO,
      role: roleStr,
      variables: {
        firstName: nameBits.firstName || nameBits.displayName || "Musician",
        date: formattedDate,
        location: shortAddress,
        fee: String(finalFee),
        role: roleStr,
        actName: act.tscName || act.name,
      },
      requestId,       // 🔗 correlation
      buttons,         // 🔗 interactive quick replies
      // No contentSid here because interactive messages don't use Content API
      smsBody: `Hi ${targetMember.firstName || "there"}, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress} at a rate of ${feeStr} for ${roleStr} duties with ${act.tscName || act.name}. Please indicate your availability 💫`,
    });

    // Persist Twilio SID + requestId to the row
    try {
      await AvailabilityModel.updateOne(
        { _id: saved._id },
        { $set: { messageSidOut: msg?.sid || null, requestId } }
      );
    } catch (e) {
      console.warn("⚠️ Could not persist messageSidOut/requestId (single):", e?.message || e);
    }

    console.log(`📲 WhatsApp sent successfully — ${feeStr}`);
    if (res) return res.json({ success: true, sent: 1 });
    return { success: true, sent: 1 };
  } catch (err) {
    console.error("❌ triggerAvailabilityRequest error:", err);
    if (res) return res.status(500).json({ success: false, message: err.message });
    return { success: false, error: err.message };
  }
};

// -------------------- Delivery/Read Receipts --------------------
// module-scope guard so we don't double-fallback on Twilio retries
export const twilioStatus = async (req, res) => {
  console.log(
    `🟢 (availabilityController.js) twilioStatus START at ${new Date().toISOString()}`,
    {}
  );
  try {
    const {
      MessageSid,
      MessageStatus, // delivered, failed, undelivered, read, sent, queued, etc.
      SmsStatus, // sometimes used instead of MessageStatus
      To, // e.g. whatsapp:+447...
      From, // your sender e.g. whatsapp:+1555...
      ErrorCode,
      ErrorMessage,
    } = req.body || {};

    const status = String(
      req.body?.MessageStatus ??
        req.body?.SmsStatus ??
        req.body?.message_status ??
        ""
    ).toLowerCase();

    const isWA = /^whatsapp:/i.test(String(From || "")); // channel we used
    const toAddr = String(To || ""); // "whatsapp:+44…" OR "+44…"

    console.log("📡 Twilio status:", {
      sid: MessageSid,
      status,
      to: toAddr,
      from: From,
      err: ErrorCode || null,
      errMsg: ErrorMessage || null,
      body: String(req.body?.Body || "").slice(0, 100) || null,
    });

    // Optionally, update DB status here if needed (not sending SMS fallback)

    return res.status(200).send("OK"); // Twilio expects 2xx
  } catch (e) {
    console.error("❌ twilioStatus error:", e);
    return res.status(200).send("OK"); // still 200 so Twilio stops retrying
  }
};

export async function notifyDeputyOneShot(req, res) {
  try {
    const { actId, lineupId, dateISO, deputy, clientName, clientEmail } = req.body;

    const act = await Act.findById(actId).lean();
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    const formattedAddress =
      act.formattedAddress || act.venueAddress || "TBC";

    await triggerAvailabilityRequest({
      actId,
      lineupId,
      dateISO,
      formattedAddress,
      clientName,
      clientEmail,
      isDeputy: true,
      deputy,
    });

    res.json({ success: true, message: "Deputy notified successfully" });
  } catch (err) {
    console.error("❌ notifyDeputyOneShot failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}


// ✅ Drop-in replacement: Twilio inbound handler with robust identity resolution,
// badge rebuilds on YES/UNAVAILABLE, and single clean SSE broadcast.
// Assumes AvailabilityModel, Musician, Act, notifyDeputies, rebuildAndApplyAvailabilityBadge,
// getDeputyDisplayBits, findCanonicalMusicianByPhone, normalizeToE164, normalizeFrom,
// seenInboundOnce, parsePayload, classifyReply, sendWhatsAppText are available in scope.

export const twilioInbound = async (req, res) => {
  console.log(`🟢 [twilioInbound] START at ${new Date().toISOString()}`);

  // ✅ Immediately acknowledge Twilio to prevent retries
  res.status(200).send("OK");

  // --- local helpers (self-contained, no external deps required) ---
  const FRONTEND_BASE =
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_SITE_BASE ||
    "https://meek-biscotti-8d5020.netlify.app";

  const pickPicLocal = (m = {}) =>
    m.photoUrl ||
    m.musicianProfileImageUpload ||
    m.profileImage ||
    m.imageUrl ||
    m.profilePicture ||
    m.musicianProfileImage ||
    null;

  const resolveDisplayName = (row, musician) => {
    const fromRow =
      (row?.selectedVocalistName || row?.vocalistName || row?.musicianName || "").trim();
    if (fromRow) return fromRow;
    const fromMus = `${musician?.firstName || ""} ${musician?.lastName || ""}`.trim();
    return fromMus || "Vocalist";
  };

  // ── NEW: robust pick + requestId parsers (button/list + text) ───────────────
  const pick = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  };

  function parseInteractive(body) {
    // Covers Content API & non-Content variants
    const id =
      pick(body, "ButtonResponse[Id]", "ButtonPayload", "ListResponse[Id]", "ListId") || null;
    const title =
      pick(body, "ButtonResponse[Text]", "ButtonText", "ListResponse[Title]", "ListTitle") || null;

    if (!id) return { requestId: null, reply: null, source: null, title: null };

    // Expect "YES:RID" / "NO:RID" / "UNAVAILABLE:RID"
    const [raw, rid] = String(id).split(":");
    const reply =
      raw?.toLowerCase().startsWith("yes") ? "yes" :
      raw?.toLowerCase().startsWith("un")  ? "unavailable" :
      raw?.toLowerCase().startsWith("no")  ? "no" : null;

    return { requestId: (rid || "").toUpperCase(), reply, source: "button", title };
  }

  function parseText(body) {
    const text = String(body?.Body || "").trim();
    if (!text) return { requestId: null, reply: null, source: null };

    // allow inline "#ABC123" anywhere in text
    const m = text.match(/#([A-Z0-9]{5,12})/i);
    const requestId = m ? m[1].toUpperCase() : null;

    const t = text.replace(/#\w+/g, "").trim().toLowerCase();
    const reply = t.startsWith("y")
      ? "yes"
      : t.startsWith("un")
      ? "unavailable"
      : t.startsWith("n")
      ? "no"
      : null;

    return { requestId, reply, source: "text" };
  }
  // --- end helpers ---

  setImmediate(() => {
    (async () => {
      try {
        const bodyObj = req.body || {};
        const bodyText = String(bodyObj?.Body || "");
        const buttonText = String(bodyObj?.ButtonText || "");
        const buttonPayload = String(bodyObj?.ButtonPayload || "");
        const inboundSid = String(bodyObj?.MessageSid || bodyObj?.SmsMessageSid || "");
        const fromRaw = String(bodyObj?.WaId || bodyObj?.From || "").replace(/^whatsapp:/i, "");

        const noContent =
          !buttonPayload &&
          !buttonText &&
          !bodyText &&
          !bodyObj["ButtonResponse[Id]"] &&
          !bodyObj["ButtonResponse[Text]"] &&
          !bodyObj["ListResponse[Id]"] &&
          !bodyObj["ListResponse[Title]"];
        if (noContent) return console.log("🪵 Ignoring empty inbound message", { From: fromRaw });

        if (seenInboundOnce(inboundSid)) {
          console.log("🪵 Duplicate inbound — already handled", { MessageSid: inboundSid });
          return;
        }

        // ── NEW: try to parse interactive payload first; then text with #RID ──
        let { requestId, reply, source } = parseInteractive(bodyObj);
        if (!requestId) {
          const p = parseText(bodyObj);
          requestId = p.requestId;
          reply = reply || p.reply;
          source = source || p.source;
        }

        // Original compatibility: keep your existing parse to get enquiryId
        // (e.g., your template might still pass enquiryId in ButtonPayload)
        let parsedPayload = { reply: null, enquiryId: null };
        try {
          parsedPayload = parsePayload(buttonPayload); // your existing helper
        } catch (_) {}
        if (!reply) {
          // still allow your classify function for plain "Yes/No/Unavailable"
          reply = classifyReply(buttonText) || classifyReply(bodyText) || parsedPayload.reply || null;
        }

        // --- Find matching availability row with strictest match first ---
        let updated = null;
        let targetRow = null;

        if (requestId) {
          targetRow = await AvailabilityModel.findOne({ requestId }).lean();
          if (!targetRow) {
            console.log("⚠️ requestId not found, soft-fallback allowed", { requestId });
          }
        }

        if (targetRow) {
          // We have an exact match by requestId — safest path
          updated = await AvailabilityModel.findOneAndUpdate(
            { _id: targetRow._id },
            {
              $set: {
                reply: reply || "no", // default to 'no' if unclassifiable
                repliedAt: new Date(),
                "inbound.sid": inboundSid || null,
                "inbound.body": bodyText || "",
                "inbound.buttonText": bodyObj["ButtonResponse[Text]"] || buttonText || null,
                "inbound.buttonPayload": bodyObj["ButtonResponse[Id]"] || buttonPayload || null,
                "inbound.source": source || null,
                "inbound.requestId": requestId,
              },
            },
            { new: true }
          );
        } else if (parsedPayload?.enquiryId) {
          // Legacy path: locate by enquiryId (as in your original)
          updated = await AvailabilityModel.findOneAndUpdate(
            { enquiryId: parsedPayload.enquiryId },
            {
              $set: {
                reply: reply || "no",
                repliedAt: new Date(),
                "inbound.sid": inboundSid,
                "inbound.body": bodyText,
                "inbound.buttonText": bodyObj["ButtonResponse[Text]"] || buttonText || null,
                "inbound.buttonPayload": bodyObj["ButtonResponse[Id]"] || buttonPayload || null,
                "inbound.source": source || null,
                ...(requestId ? { requestId, "inbound.requestId": requestId } : {}),
              },
            },
            { new: true }
          );
        } else {
          // Fallback: last row by phone (your original behavior)
          updated = await AvailabilityModel.findOneAndUpdate(
            { phone: normalizeFrom(fromRaw) },
            {
              $set: {
                reply: reply || "no",
                repliedAt: new Date(),
                "inbound.sid": inboundSid,
                "inbound.body": bodyText,
                "inbound.buttonText": bodyObj["ButtonResponse[Text]"] || buttonText || null,
                "inbound.buttonPayload": bodyObj["ButtonResponse[Id]"] || buttonPayload || null,
                "inbound.source": source || null,
                ...(requestId ? { requestId, "inbound.requestId": requestId } : {}),
              },
            },
            { sort: { createdAt: -1 }, new: true }
          );
        }

        if (!updated) {
          console.warn("⚠️ No matching AvailabilityModel found for inbound reply.");
          return;
        }

        // 🔎 Resolve canonical Musician by phone (preferred) or by row's musicianId
        const byPhone = await findCanonicalMusicianByPhone(updated.phone);
        let musician =
          byPhone || (updated?.musicianId ? await Musician.findById(updated.musicianId).lean() : null);

        // If deputy row is carrying ACT collection id, re-point to canonical Musician id
        if (updated.isDeputy && musician && String(updated.musicianId) !== String(musician._id)) {
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            {
              $set: {
                musicianId: musician._id,
                musicianName: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
                musicianEmail: musician.email || updated.musicianEmail || "",
                photoUrl: pickPicLocal(musician),
                profileUrl: `${FRONTEND_BASE}/musician/${musician._id}`,
              },
            }
          );

          // keep in-memory copy in sync for the rest of this handler
          updated.musicianId = musician._id;
          updated.musicianName = `${musician.firstName || ""} ${musician.lastName || ""}`.trim();
          updated.musicianEmail = musician.email || updated.musicianEmail;
          updated.photoUrl = pickPicLocal(musician) || updated.photoUrl;
          updated.profileUrl = `${FRONTEND_BASE}/musician/${musician._id}`;
        }

        const displayName = resolveDisplayName(updated, musician);

        // 📛 Ensure the row carries a stable vocalistName for downstream badge/name use
        if (displayName && updated?.vocalistName !== displayName) {
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            {
              $set: {
                vocalistName: displayName,
                musicianName: updated?.musicianName || displayName, // keep old field too
              },
            }
          );
          updated.vocalistName = displayName; // in-memory
          if (!updated.musicianName) updated.musicianName = displayName;
        }

        // 🧩 Slot + deputy flags
        const slotIndex = typeof updated.slotIndex === "number" ? updated.slotIndex : null;
        console.log("🎯 [twilioInbound] Matched slotIndex:", slotIndex);

        const isDeputy = Boolean(updated?.isDeputy);
        if (isDeputy && updated?.isDeputy !== true) {
          await AvailabilityModel.updateOne({ _id: updated._id }, { $set: { isDeputy: true } });
          updated.isDeputy = true;
        }

        // 🔍 Ensure we have a musician doc when possible (fallbacks preserved)
        if (!musician && updated?.musicianId) {
          musician = await Musician.findById(updated.musicianId).lean();
        }
        if (!musician && updated?.musicianName) {
          const parts = String(updated.musicianName).trim().split(/\s+/);
          musician = await Musician.findOne({
            $or: [
              { name: updated.musicianName },
              { firstName: new RegExp(parts[0] || "", "i") },
              { lastName: new RegExp(parts.slice(-1)[0] || "", "i") },
            ],
          })
            .select(
              "email firstName lastName musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl _id"
            )
            .lean();
        }

        // 🔹 Enrich identity bits (email/photo/profile) from either row or musician
        const bits = await getDeputyDisplayBits({
          ...((musician && musician.toObject ? musician.toObject() : musician) || {}),
          ...((updated && updated.toObject ? updated.toObject() : updated) || {}),
        });

        const emailForInvite =
          bits?.resolvedEmail ||
          musician?.email ||
          updated?.musicianEmail ||
          updated?.email ||
          "hello@thesupremecollective.co.uk";

        console.log("📧 [twilioInbound] Using emailForInvite:", emailForInvite);

        const actId = String(updated.actId);
        const dateISO = updated.dateISO;
        const toE164 = normalizeToE164(updated.phone || fromRaw);

        // 🧭 Resolve Act reliably
        let act = null;
        try {
          const actIdValue = updated?.actId?._id || updated?.actId;
          if (actIdValue) {
            act = await Act.findById(actIdValue).lean();
            console.log("📡 Act resolved for notifyDeputies:", act?.tscName || act?.name);
          }
        } catch (err) {
          console.warn("⚠️ Failed to resolve act from updated.actId:", err.message);
        }

        // ──────────────────────────────────────────────────────────────
        console.log("──────────────────────────────────────────────");
        console.log(
          `📩 Twilio Inbound (${reply?.toUpperCase?.() || "UNKNOWN"}) for ${act?.tscName || "Unknown Act"}`
        );
        console.log(`👤 ${musician?.firstName || updated?.musicianName || "Unknown Musician"}`);
        console.log(`📅 ${updated?.dateISO || "Unknown Date"}`);
        console.log(`📧 ${emailForInvite}`);
        console.log("──────────────────────────────────────────────");

        /* ---------------------------------------------------------------------- */
        /* ✅ YES BRANCH (Lead or Deputy) — unchanged logic                       */
        /* ---------------------------------------------------------------------- */
        if (reply === "yes") {
          console.log(`✅ YES reply received via WhatsApp (${isDeputy ? "Deputy" : "Lead"})`);

          const { createCalendarInvite, cancelCalendarInvite } = await import("./googleController.js");

          // 1️⃣ Create/refresh calendar invite
          console.log(
            "📧 [Calendar Debug] emailForInvite=",
            emailForInvite,
            "act=",
            !!act,
            "dateISO=",
            dateISO
          );
          if (emailForInvite && act && dateISO) {
            const formattedDateString = new Date(dateISO).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            });

            const fee =
              updated?.fee ||
              act?.lineups?.[0]?.bandMembers?.find((m) => m.isEssential)?.fee ||
              null;

            try {
              // 🧹 Cancel prior event if it exists, then create a fresh one
              if (updated?.calendarEventId && emailForInvite) {
                try {
                  console.log("🗓️ Cancelling old calendar event before new YES invite");
                  await cancelCalendarInvite({
                    eventId: updated.calendarEventId,
                    actId: act?._id || updated.actId,
                    dateISO: updated.dateISO,
                    email: emailForInvite,
                  });
                } catch (err) {
                  console.warn("⚠️ Failed to cancel old calendar event:", err.message);
                }
              }

              const event = await createCalendarInvite({
                enquiryId: updated.enquiryId || `ENQ_${Date.now()}`,
                actId,
                dateISO,
                email: emailForInvite,
                summary: `TSC: ${act.tscName || act.name} enquiry`,
                description: [
                  `Event Date: ${formattedDateString}`,
                  `Act: ${act.tscName || act.name}`,
                  `Role: ${updated.duties || ""}`,
                  `Address: ${updated.formattedAddress || "TBC"}`,
                  `Fee: £${fee || "TBC"}`,
                ].join("\n"),
                startTime: `${dateISO}T17:00:00Z`,
                endTime: `${dateISO}T23:59:00Z`,
                fee,
              });

              console.log("📅 Calendar invite sent:", emailForInvite, {
                eventId: event?.id || event?.data?.id,
              });

              await AvailabilityModel.updateOne(
                { _id: updated._id },
                {
                  $set: {
                    calendarEventId: event?.id || event?.data?.id || null,
                    calendarInviteEmail: emailForInvite,
                    calendarInviteSentAt: new Date(),
                    calendarStatus: "needsAction",
                  },
                }
              );
            } catch (err) {
              console.error("❌ Calendar invite failed:", err.message);
            }
          }

          console.log("🟦 About to sendWhatsAppMessage using content SID:", process.env.TWILIO_ENQUIRY_SID);
          await sendWhatsAppText(
            toE164,
            "Super — we’ll send a diary invite to log the enquiry for your records."
          );

          // 2️⃣ Mark as read + (if deputy) persist flag
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            { $set: { status: "read", ...(isDeputy ? { isDeputy: true } : {}) } }
          );

          // 3️⃣ Rebuild badge NOW (prevents flicker/drops)
          let badgeResult = null;
          try {
            badgeResult = await rebuildAndApplyAvailabilityBadge({
              actId,
              dateISO,
              __fromYesFlow: true,
            });
          } catch (e) {
            console.warn("⚠️ Badge rebuild failed:", e?.message || e);
          }

          // 4️⃣ SSE broadcast (single clean event + badgeUpdated)
          if (global.availabilityNotify) {
            const payload = {
              actId,
              actName: act?.tscName || act?.name,
              musicianName: displayName,
              dateISO,
              musicianId: musician?._id || updated?.musicianId || null,
            };

            if (isDeputy && global.availabilityNotify.deputyYes) {
              global.availabilityNotify.deputyYes(payload);
            }
            if (!isDeputy && global.availabilityNotify.leadYes) {
              global.availabilityNotify.leadYes(payload);
            }
            if (badgeResult?.badge && global.availabilityNotify.badgeUpdated) {
              global.availabilityNotify.badgeUpdated({
                actId,
                actName: act?.tscName || act?.name,
                dateISO,
                badge: badgeResult.badge,
              });
            }
          }

          console.log("📡 SSE broadcasted: availability_badge_updated");
          return;
        } // ← YES branch

        /* ---------------------------------------------------------------------- */
        /* 🚫 NO / UNAVAILABLE / NOLOC / NOLOCATION BRANCH — unchanged logic      */
        /* ---------------------------------------------------------------------- */
        if (["no", "unavailable", "noloc", "nolocation"].includes(reply)) {
          console.log("🚫 UNAVAILABLE reply received via WhatsApp");

          await AvailabilityModel.updateMany(
            {
              musicianEmail: (emailForInvite || "").toLowerCase(),
              dateISO: updated.dateISO,
            },
            {
              $set: {
                status: "unavailable",
                reply: "unavailable",
                repliedAt: new Date(),
                calendarStatus: "cancelled",
              },
            }
          );
          console.log(
            `🚫 Marked all enquiries for ${emailForInvite} on ${updated.dateISO} as unavailable`
          );

          // 🗓️ Cancel calendar event if exists
          try {
            const { cancelCalendarInvite } = await import("./googleController.js");
            await cancelCalendarInvite({
              eventId: updated.calendarEventId,
              dateISO: updated.dateISO,
              email: emailForInvite,
            });
          } catch (err) {
            console.error("❌ Failed to cancel shared event:", err.message);
          }

          // 🔔 Rebuild badge *immediately* so remaining badges persist (e.g., Kedesha stays visible)
          let rebuilt = null;
          try {
            rebuilt = await rebuildAndApplyAvailabilityBadge({ actId, dateISO, __fromUnavailable: true });
          } catch (e) {
            console.warn("⚠️ Badge rebuild (unavailable) failed:", e?.message || e);
          }

          // 🗑️ Clear legacy badge keys in Act (tbc/non-tbc map keys)
          try {
            const unset = {
              [`availabilityBadges.${dateISO}_tbc`]: "",
            };
            await Act.updateOne({ _id: actId }, { $unset: unset });
            console.log("🗑️ Cleared legacy TBC badge key for:", dateISO);
          } catch (err) {
            console.error("❌ Failed to $unset legacy TBC badge key:", err.message);
          }

          await sendWhatsAppText(
            toE164,
            "Thanks for letting us know — we've updated your availability."
          );

          // ✅ Trigger deputies when LEAD replies unavailable/no/noloc/nolocation
          const shouldTriggerDeputies =
            !isDeputy && ["unavailable", "no", "noloc", "nolocation"].includes(reply);

          if (act?._id && shouldTriggerDeputies) {
            console.log(
              `📢 Triggering deputy notifications for ${act?.tscName || act?.name} — ${dateISO}`
            );
            await notifyDeputies({
              actId: act._id,
              lineupId: updated.lineupId || act.lineups?.[0]?._id || null,
              dateISO,
              formattedAddress: updated.formattedAddress || act.formattedAddress || "TBC",
              clientName: updated.clientName || "",
              clientEmail: updated.clientEmail || "",
              slotIndex, // keep grouping aligned
              skipDuplicateCheck: true,
              skipIfUnavailable: false,
            });
            console.log("📤 notifyDeputies triggered with slotIndex:", slotIndex);
          } else if (isDeputy && reply === "unavailable") {
            console.log("📨 Deputy unavailable — trigger next deputy in queue");
            await triggerNextDeputy({
              actId: act._id,
              lineupId: updated.lineupId || act.lineups?.[0]?._id || null,
              dateISO,
              excludePhones: [
                updated.phone,
                updated.whatsappNumber,
                ...(await AvailabilityModel.distinct("phone", {
                  actId,
                  dateISO,
                  reply: { $in: ["unavailable", "yes"] },
                })),
              ],
            });
          }

          // 📨 Courtesy cancellation email
          try {
            const { sendEmail } = await import("../utils/sendEmail.js");
            const subject = `❌ ${act?.tscName || act?.name}: Diary Invite Cancelled for ${new Date(
              dateISO
            ).toLocaleDateString("en-GB")}`;
            const html = `
              <p><strong>${updated?.musicianName || musician?.firstName || "Lead Musician"}</strong>,</p>
              <p>Your diary invite for <b>${act?.tscName || act?.name}</b> on <b>${new Date(
                dateISO
              ).toLocaleDateString("en-GB")}</b> has been cancelled.</p>
              <p>If your availability changes, reply "Yes" to the WhatsApp message to re-confirm.</p>
              <br/>
              <p>– The Supreme Collective Team</p>
            `;

            const leadEmail = (emailForInvite || "").trim();
            const recipients = [leadEmail].filter((e) => e && e.includes("@"));

            if (recipients.length > 0) {
              console.log("📧 Preparing to send cancellation email:", recipients);
              await sendEmail({
                to: recipients,
                bcc: ["hello@thesupremecollective.co.uk"],
                subject,
                html,
              });
              console.log(`✅ Cancellation email sent successfully to: ${recipients.join(", ")}`);
            } else {
              console.warn("⚠️ Skipping cancellation email — no valid recipients found.");
            }
          } catch (emailErr) {
            console.error("❌ Failed to send cancellation email:", emailErr.message);
          }

          // 🔒 Lock meta so lead badge stays cleared if appropriate (doesn't undo deputy YES)
          const update = {
            $unset: {
              // clear any old exact-date badge map; the rebuilt badge above will repopulate correctly
              [`availabilityBadges.${dateISO}`]: "",
              [`availabilityBadges.${dateISO}_tbc`]: "",
            },
          };
          if (!isDeputy && ["unavailable", "no", "noloc", "nolocation"].includes(reply)) {
            update.$set = {
              [`availabilityBadgesMeta.${dateISO}.lockedByLeadUnavailable`]: true,
            };
          }
          await Act.updateOne({ _id: actId }, update);
          console.log("🔒 Lead marked UNAVAILABLE — badge locked for date:", dateISO);

          // 📡 SSE: push rebuilt badge to clients (so remaining vocalist stays on cards/UI)
          if (rebuilt?.badge && global.availabilityNotify?.badgeUpdated) {
            global.availabilityNotify.badgeUpdated({
              actId,
              actName: act?.tscName || act?.name,
              dateISO,
              badge: rebuilt.badge,
            });
          }

          return;
        } // ← UNAVAILABLE branch

        // If we reach here, reply type wasn’t handled (e.g., "maybe")
        console.log("ℹ️ Inbound reply ignored (not YES/NO/UNAVAILABLE/NOL0C):", reply);
      } catch (err) {
        console.error("❌ Error in twilioInbound background task:", err);
      }
    })(); // async IIFE
  }); // setImmediate
};

const INBOUND_SEEN = new Map();
const INBOUND_TTL_MS = 10 * 60 * 1000;

function seenInboundOnce(sid) {
  console.log(
    `🟢 (availabilityController.js) seenInboundOnce START at ${new Date().toISOString()}`,
    {}
  );
  if (!sid) return false;
  const now = Date.now();
  for (const [k, t] of INBOUND_SEEN) {
    if (now - t > INBOUND_TTL_MS) INBOUND_SEEN.delete(k);
  }
  if (INBOUND_SEEN.has(sid)) return true;
  INBOUND_SEEN.set(sid, now);
  return false;
}

// Format date like "Saturday, 5th Oct 2025"
const formatWithOrdinal = (dateLike) => {
  console.log(
    `🟢 (availabilityController.js) formatWithOrdinal START at ${new Date().toISOString()}`,
    {}
  );
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
  const month = d.toLocaleDateString("en-GB", { month: "short" }); // Oct
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
};

const firstNameOf = (p) => {
  console.log(
    `🟢 (availabilityController.js) firstNameOf START at ${new Date().toISOString()}`,
    {}
  );
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
// -------------------- Outbound Trigger --------------------

// ✅ Unified version ensuring correct photoUrl vs profileUrl distinction

// -------------------- SSE Broadcaster --------------------

// availabilityNotify.js (or wherever you define global.availabilityNotify / broadcast helpers)
const recentEvents = new Map(); // module-scope TTL cache

function dedupeAndBroadcast(key, emitFn) {
  if (recentEvents.has(key)) return;
  recentEvents.set(key, Date.now());
  setTimeout(() => recentEvents.delete(key), 2000);
  emitFn();
}

// Example wiring with socket.io `io.emit` (adjust to your emitter)
global.availabilityNotify = {
  leadYes: (p) =>
    dedupeAndBroadcast(
      `${p.actId}:${p.dateISO}:leadYes:${p.musicianId}`,
      () => io.emit("lead_yes", p)
    ),
  deputyYes: (p) =>
    dedupeAndBroadcast(
      `${p.actId}:${p.dateISO}:deputyYes:${p.musicianId}`,
      () => io.emit("deputy_yes", p)
    ),
  badgeUpdated: (p) =>
    dedupeAndBroadcast(
      `${p.actId}:${p.dateISO}:badgeUpdated`,
      () => io.emit("availability_badge_updated", p)
    ),
};

// If you don't wrap global, you can inline this exactly before any broadcast:
///
/// const key = `${actId}:${dateISO}:leadYes:${musicianId}`;
// if (recentEvents.has(key)) return;
// recentEvents.set(key, Date.now());
// setTimeout(() => recentEvents.delete(key), 2000);
// io.emit('lead_yes', payload);

// ───────────────────────────────────────────────────────────────────────────────
// makeAvailabilityBroadcaster — with identity-focused console logging
// ───────────────────────────────────────────────────────────────────────────────
export const makeAvailabilityBroadcaster = (broadcastFn) => {
  // Small helpers local to this broadcaster
  const toStr = (v) => (typeof v === "string" ? v : "");
  const splitName = (name) => {
    const n = toStr(name).trim();
    if (!n) return { first: "", last: "" };
    const parts = n.split(/\s+/);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    return { first, last };
  };
  const logIdentity = (label, obj = {}) => {
    const { first = "", last = "" } = splitName(
      obj.displayName || obj.vocalistDisplayName || obj.musicianName
    );
    console.log(`📡 [SSE] ${label}`, {
      actId: obj.actId,
      actName: obj.actName,
      dateISO: obj.dateISO,
      firstName: obj.firstName || first || undefined,
      lastName: obj.lastName || last || undefined,
      displayName:
        obj.displayName ||
        obj.musicianName ||
        obj.vocalistDisplayName ||
        undefined,
      vocalistDisplayName:
        obj.vocalistDisplayName || obj.displayName || undefined,
      profileUrl: obj.profileUrl || undefined,
      photoUrl: obj.photoUrl || undefined,
      address: obj.address || undefined,
      formattedAddress: obj.formattedAddress || undefined,
      isDeputy: obj.isDeputy === true,
      musicianId: obj.musicianId ? String(obj.musicianId) : undefined,
      slotIndex: obj.slotIndex ?? undefined,
      slotsCount:
        Array.isArray(obj.badge?.slots) ? obj.badge.slots.length : undefined,
    });
  };

  // Build a quick identity snapshot from a badge slot (if present)
  const snapshotFromSlot = (slot = {}) => {
    const dn =
      slot.vocalistName ||
      slot.primary?.displayName ||
      slot.primary?.musicianName ||
      "";
    const { first, last } = splitName(dn);
    return {
      firstName: first,
      lastName: last,
      displayName: dn || undefined,
      vocalistDisplayName: dn || undefined,
      profileUrl: slot.primary?.profileUrl || slot.profileUrl || undefined,
      photoUrl: slot.primary?.photoUrl || slot.photoUrl || undefined,
      isDeputy: Boolean(slot.primary?.isDeputy),
      musicianId:
        slot.primary?.musicianId || slot.musicianId || slot?.primary?.id || null,
      slotIndex: slot.slotIndex,
    };
  };

  return {
    // Lead vocalist confirmed YES
    leadYes: ({ actId, actName, musicianName, dateISO, musicianId }) => {
      const { first, last } = splitName(musicianName);
      logIdentity("leadYes (pre-broadcast)", {
        actId,
        actName,
        dateISO,
        firstName: first,
        lastName: last,
        displayName: musicianName,
        vocalistDisplayName: musicianName,
        isDeputy: false,
        musicianId,
      });

      broadcastFn({
        type: "availability_yes", // frontend normalizes to "leadYes"
        actId,
        actName,
        musicianName: musicianName || "Lead Vocalist",
        musicianId: musicianId || null,
        dateISO,
      });

      console.log("📤 [SSE] leadYes broadcast dispatched", {
        actId,
        actName,
        dateISO,
        musicianId: musicianId || null,
      });
    },

    // Deputy confirmed YES
    deputyYes: ({ actId, actName, musicianName, dateISO, badge, musicianId }) => {
      const dep0 =
        Array.isArray(badge?.deputies) && badge.deputies.length
          ? badge.deputies[0]
          : null;

      const deputyName =
        musicianName ||
        dep0?.vocalistName ||
        dep0?.name ||
        "Deputy Vocalist";

      const { first, last } = splitName(deputyName);
      const profileUrl =
        dep0?.profileUrl ||
        badge?.primary?.profileUrl ||
        badge?.profileUrl ||
        undefined;
      const photoUrl =
        dep0?.photoUrl || badge?.primary?.photoUrl || badge?.photoUrl || undefined;
      const resolvedMusicianId = musicianId || dep0?.musicianId || null;

      logIdentity("deputyYes (pre-broadcast)", {
        actId,
        actName,
        dateISO,
        firstName: first,
        lastName: last,
        displayName: deputyName,
        vocalistDisplayName: deputyName,
        profileUrl,
        photoUrl,
        isDeputy: true,
        musicianId: resolvedMusicianId,
        badge, // for slotsCount
      });

      broadcastFn({
        type: "availability_deputy_yes",
        actId,
        actName,
        musicianName: deputyName,
        musicianId: resolvedMusicianId,
        dateISO,
      });

      console.log("📤 [SSE] deputyYes broadcast dispatched", {
        actId,
        actName,
        dateISO,
        musicianId: resolvedMusicianId,
      });
    },

    // Full badge update (SSE)
    badgeUpdated: ({ actId, actName, dateISO, badge }) => {
      if (!badge) {
        console.log("🔕 [SSE] badge was null/undefined – skipping broadcast", {
          actId,
          dateISO,
        });
        return;
      }

      // Try to surface a primary slot identity for richer logs
      const primarySlot = Array.isArray(badge.slots)
        ? badge.slots.find((s) => s?.primary) || badge.slots[0]
        : undefined;

      if (primarySlot) {
        const snap = snapshotFromSlot(primarySlot);
        logIdentity("badgeUpdated (primary slot snapshot)", {
          ...snap,
          actId,
          actName,
          dateISO,
          address: badge.address || undefined,
          formattedAddress: badge.address || undefined,
          badge,
        });
      } else {
        console.log("🟡 [SSE] badgeUpdated: no slots available to snapshot", {
          actId,
          actName,
          dateISO,
        });
      }

      broadcastFn({
        type: "availability_badge_updated",
        actId,
        actName,
        dateISO,
        badge,
      });

      console.log("📤 [SSE] badgeUpdated broadcast dispatched", {
        actId,
        actName,
        dateISO,
        slots: Array.isArray(badge.slots) ? badge.slots.length : 0,
      });
    },
  };
};






export async function buildAvailabilityBadgeFromRows({ actId, dateISO, hasLineups = true }) {
  console.log("🟣 buildAvailabilityBadgeFromRows START", { actId, dateISO, hasLineups });

  const rows = await AvailabilityModel.find({
    actId,
    dateISO,
    reply: { $in: ["yes", "no", "unavailable", null] },
    v2: true,
  })
    .select("musicianId slotIndex reply updatedAt repliedAt isDeputy photoUrl phone musicianEmail formattedAddress vocalistName musicianName selectedVocalistName")
    .lean();

  // Build a cache of musician display names for fallback name resolution
  const ids = [...new Set(rows.map((r) => String(r.musicianId)).filter(Boolean))];
  const musDocs = await Musician.find({ _id: { $in: ids } })
    .select("firstName lastName displayName preferredName name")
    .lean();
  const musById = Object.fromEntries(musDocs.map((m) => [String(m._id), m]));

  const pickDisplayName = (m) => {
    if (!m) return "";
    const s = m.displayName || m.preferredName || m.name || "";
    if (typeof s === "string" && s.trim()) return s.trim();
    const fn = (m.firstName || "").trim();
    const ln = (m.lastName || "").trim();
    return `${fn} ${ln}`.trim();
  };

  console.log("📥 buildBadge: availability rows (identity snapshot):", rows.map(r => ({
    slotIndex: r.slotIndex,
    reply: r.reply,
    updatedAt: r.updatedAt,
    isDeputy: r.isDeputy,
    musicianId: r.musicianId,
    vocalistName: r.vocalistName,
    photoUrl: r.photoUrl,
    profileUrl: r.profileUrl,
    phone: r.phone,
    formattedAddress: r.formattedAddress,
  })));

  if (!rows.length) return null;

  const groupedBySlot = rows.reduce((acc, row) => {
    const key = String(row.slotIndex ?? 0);
    (acc[key] ||= []).push(row);
    return acc;
  }, {});
  console.log("📦 buildBadge: rows grouped by slot:", Object.keys(groupedBySlot));

  const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

  const slots = [];
  const orderedKeys = Object.keys(groupedBySlot).sort((a, b) => Number(a) - Number(b));

  for (const slotKey of orderedKeys) {
    const slotRows = groupedBySlot[slotKey];
    console.log(`🟨 SLOT ${slotKey} — raw rows:`, slotRows.length);

    const leadRows   = slotRows.filter(r => r.isDeputy !== true);
    const deputyRows = slotRows.filter(r => r.isDeputy === true);

    const leadReply = leadRows
      .filter(r => ["yes", "no", "unavailable"].includes(r.reply))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;

    let leadDisplayBits = null;
    if (leadReply?.musicianId) {
      try {
        leadDisplayBits = await getDeputyDisplayBits({ musicianId: leadReply.musicianId });
      } catch (e) {
        console.warn("getDeputyDisplayBits (lead) failed:", e?.message);
      }
    }

    const leadBits = leadDisplayBits
      ? {
          musicianId: String(leadDisplayBits.musicianId || leadReply?.musicianId || ""),
          photoUrl: leadDisplayBits.photoUrl || null,
          profileUrl: leadDisplayBits.profileUrl || "",
          setAt: leadReply?.updatedAt || null,
          state: leadReply?.reply || "pending",
          available: leadReply?.reply === "yes",
          isDeputy: false,
          // (Optional: also add vocalistName for uniformity)
          // vocalistName: chosenName, // see below
        }
      : (leadReply
          ? {
              musicianId: String(leadReply.musicianId || ""),
              photoUrl: null,
              profileUrl: "",
              setAt: leadReply.updatedAt || null,
              state: leadReply.reply || "pending",
              available: leadReply.reply === "yes",
              isDeputy: false,
            }
          : null);

    // Deputies (sorted latest first)
    const deputyRowsSorted = deputyRows.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const deputies = [];
    for (const r of deputyRowsSorted) {
      try {
        const bits = await getDeputyDisplayBits({
          musicianId: r.musicianId,
          phone: r.phone,
          email: r.musicianEmail,
        });
        deputies.push({
          slotIndex: Number(slotKey),
          isDeputy: true,
          musicianId: String(bits?.musicianId || r.musicianId || ""),
          photoUrl: bits?.photoUrl || r?.photoUrl || null,
          profileUrl: bits?.profileUrl || "",
          vocalistName:
            (bits?.resolvedName ||
             r?.selectedVocalistName ||
             r?.vocalistName ||
             pickDisplayName(musById[String(r.musicianId)]) ||
             "").trim(),
          state: r.reply ?? null,
          available: r.reply === "yes",
          setAt: r.updatedAt || null,
          repliedAt: r.repliedAt || r.updatedAt || null,
        });
      } catch (e) {
        console.warn("getDeputyDisplayBits (deputy) failed:", e?.message, r?.musicianId);
      }
    }

    const leadAvailable = leadBits?.available === true;
    const coveringYes = deputies.find(d => d.available && isHttp(d.photoUrl));
    const firstDepWithPhoto = deputies.find(d => isHttp(d.photoUrl));

    let primary = null;
    if (!leadAvailable && coveringYes) {
      primary = coveringYes; // deputy with YES
    } else if (leadAvailable && isHttp(leadBits?.photoUrl)) {
      primary = leadBits; // lead with photo
    } else if (!leadAvailable && firstDepWithPhoto) {
      primary = firstDepWithPhoto; // fallback visual
    } else if (isHttp(leadBits?.photoUrl)) {
      primary = leadBits; // last resort photo
    }

    // Choose name for the slot (use cached musician docs as fallback, avoid per-slot DB queries)
    const leadMus = leadReply?.musicianId
      ? musById[String(leadReply.musicianId)] || null
      : null;

    const chosenName =
      (leadReply?.selectedVocalistName ||
       leadReply?.vocalistName ||
       leadReply?.musicianName ||
       pickDisplayName(leadMus) ||
       "").trim();

    if (leadBits && leadDisplayBits) {
      leadBits.vocalistName = chosenName;
    }

    const slotObj = {
      slotIndex: Number(slotKey),
      isDeputy: false, // legacy
      vocalistName: chosenName,
      musicianId: leadBits?.musicianId ?? (leadReply ? String(leadReply.musicianId) : null),
      photoUrl: leadBits?.photoUrl || null,
      profileUrl: leadBits?.profileUrl || "",
      deputies,
      setAt: leadReply?.updatedAt || null,
      state: leadReply?.reply || "pending",

      available: Boolean(leadAvailable || coveringYes),
      covering: primary?.isDeputy ? "deputy" : "lead",
      primary: primary
        ? {
            musicianId: primary.musicianId || null,
            photoUrl: primary.photoUrl || null,
            profileUrl: primary.profileUrl || "",
            setAt: primary.setAt || null,
            isDeputy: Boolean(primary.isDeputy),
            available: Boolean(primary.available ?? (primary.isDeputy ? primary.available : leadAvailable)),
          }
        : null,
    };

    // Identity snapshot for this slot
    const idSnap = firstLast(slotObj.vocalistName);
    console.log("👤 SlotSummary", {
      musicianId: slotObj.musicianId,
      firstName: idSnap.firstName,
      lastName: idSnap.lastName,
      displayName: idSnap.displayName,
      vocalistDisplayName: slotObj.vocalistName,
      phone: (leadReply?.phone || null),
      photoUrl: slotObj.photoUrl,
      profileUrl: slotObj.profileUrl,
      setAt: slotObj.setAt,
      isDeputy: slotObj.isDeputy,
      available: slotObj.available,
      slotIndex: slotObj.slotIndex,
    });

    slots.push(slotObj);
  }

  // Pick an address from any row
  const anyAddress = rows.find(r => r.formattedAddress)?.formattedAddress || "TBC";
  const badge = { dateISO, address: anyAddress, active: true, slots };

  console.log("💜 FINAL BADGE (identity snapshot):", {
    dateISO: badge.dateISO,
    address: badge.address,
    slots: badge.slots.map(s => ({
      slotIndex: s.slotIndex,
      vocalistName: s.vocalistName,
      available: s.available,
      covering: s.covering,
      primary: s.primary ? { musicianId: s.primary.musicianId } : null,
    }))
  });

  return badge;
}



export async function rebuildAndApplyAvailabilityBadge({ actId, dateISO }) {
  console.log("🟦 [rebuildAndApplyAvailabilityBadge] START", { actId, dateISO });

  if (!actId || !dateISO) {
    console.error("❌ rebuildAndApplyAvailabilityBadge missing actId/dateISO", { actId, dateISO });
    return null;
  }

  const actDoc = await Act.findById(actId)
    .select("+availabilityBadgesMeta lineups tscName name formattedAddress venueAddress")
    .lean();

  console.log("📘 [rebuildAndApplyAvailabilityBadge] actDoc fetched", {
    actName: actDoc?.tscName || actDoc?.name,
    actId: String(actId),
    hasLineups: Array.isArray(actDoc?.lineups),
    hasMetaForDate: !!actDoc?.availabilityBadgesMeta?.[dateISO],
  });

  if (!actDoc) return { success: false, message: "Act not found" };

  let badge = await buildAvailabilityBadgeFromRows({
    actId,
    dateISO,
    hasLineups: actDoc?.hasLineups ?? true,
  });

  /** Normalise a good display name from a musician doc */
const pickDisplayName = (m) => {
  if (!m) return "";
  const s =
    m.displayName ||
    m.preferredName ||
    m.vocalistName ||           // some schemas keep this
    m.name ||
    "";
  if (typeof s === "string" && s.trim()) return s.trim();
  const fn = (m.firstName || m.first_name || "").trim();
  const ln = (m.lastName || m.last_name || "").trim();
  return `${fn} ${ln}`.trim();
};

// Gather any musicianIds that are missing vocalistName
const missingIds = [];
for (const slot of badge?.slots || []) {
  if (slot?.primary?.musicianId && !slot.primary.vocalistName) {
    missingIds.push(String(slot.primary.musicianId));
  }
  for (const d of slot?.deputies || []) {
    if (d?.musicianId && !d.vocalistName) {
      missingIds.push(String(d.musicianId));
    }
  }
}

if (missingIds.length) {
  const uniqIds = [...new Set(missingIds)];
  const musDocs = await Musician.find({ _id: { $in: uniqIds } })
    .select("firstName lastName displayName preferredName name")
    .lean();
  const musById = Object.fromEntries(musDocs.map((m) => [String(m._id), m]));

  for (const slot of badge.slots || []) {
    if (slot?.primary && !slot.primary.vocalistName) {
      const m = musById[String(slot.primary.musicianId)];
      slot.primary.vocalistName = pickDisplayName(m);
    }
    if (Array.isArray(slot?.deputies)) {
      slot.deputies = slot.deputies.map((d) => {
        if (d.vocalistName && d.vocalistName.trim()) return d;
        const m = musById[String(d.musicianId)];
        return { ...d, vocalistName: pickDisplayName(m) };
        }
      );
    }
  }
}

  console.log("🎨 [rebuildAndApplyAvailabilityBadge] Raw badge", {
    hasBadge: !!badge,
    address: badge?.address,
    formattedAddress: actDoc?.formattedAddress,
    profileUrl: badge?.slots?.find(s => s?.primary)?.primary?.profileUrl || "",
    photoUrl: badge?.slots?.find(s => s?.primary)?.primary?.photoUrl || null,
    slotsCount: badge?.slots?.length || 0,
  });

  

  // Pull rows for optional email + safe summaries
  const availRows = await AvailabilityModel.find({ actId, dateISO }).lean();
  console.log("📥 Availability rows at rebuild:", availRows.map(r => ({
    id: r._id,
    musicianId: r.musicianId,
    reply: r.reply,
    slotIndex: r.slotIndex,
    updatedAt: r.updatedAt
  })));

  // If no badge → clear
  if (!badge) {
    console.log("🟠 No badge returned — attempting CLEAR operation");

    const stillActive = await AvailabilityModel.exists({ actId, dateISO, reply: "yes" });
    if (stillActive) {
      console.log("🟡 CLEAR skipped — active YES rows still present");
      return { success: true, skipped: true };
    }

    await Act.updateOne({ _id: actId }, { $unset: { [`availabilityBadges.${dateISO}`]: "" } });
    console.log("🧹 CLEARED legacy key", { actId, dateISO });
    return { success: true, cleared: true };
  }

  // Compute storage key: dateISO + short address (lower, underscored)
  const addressForKey = badge.address || actDoc?.formattedAddress || actDoc?.venueAddress || "TBC";
  const shortAddress = String(addressForKey)
    .replace(/\b(united_kingdom|uk)\b/gi, "")
    .replace(/\W+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();

  const key = `${dateISO}_${shortAddress}`;

  // (Optional) safe primary summary (NO presentRow!)
  const idxPrimarySlot = (badge.slots || []).findIndex(s => !!s?.primary);
  const primaryRef = idxPrimarySlot >= 0 ? badge.slots[idxPrimarySlot].primary : null;
const primaryName =
  idxPrimarySlot >= 0
    ? (
        badge.slots[idxPrimarySlot].vocalistName ||
        badge.slots[idxPrimarySlot]?.primary?.vocalistName ||
        ""
      )
    : "";
   // Ensure we always pass a *string* into the name splitter
const toNameString = (v) =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : pickDisplayName(v) || ""; // uses the helper you defined above

const safeFirstLast = (s = "") => {
  const str = String(s || "").trim().replace(/\s+/g, " ");
  if (!str) return { firstName: "", lastName: "", displayName: "" };
  const parts = str.split(" ");
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  const displayName = lastName ? `${firstName} ${lastName[0].toUpperCase()}` : firstName;
  return { firstName, lastName, displayName };
};

const nameSnap = safeFirstLast(toNameString(primaryName));

  console.log("👤 PrimaryChosen", {
    musicianId: primaryRef?.musicianId || null,
    firstName: nameSnap.firstName,
    lastName: nameSnap.lastName,
    displayName: nameSnap.displayName,
    vocalistDisplayName: primaryName,
    photoUrl: primaryRef?.photoUrl || null,
    profileUrl: primaryRef?.profileUrl || "",
    isDeputy: !!primaryRef?.isDeputy,
    phone: null,
    setAt: primaryRef?.setAt || null,
    available: !!primaryRef?.available,
    slotIndex: idxPrimarySlot >= 0 ? idxPrimarySlot : null,
  });

  // SAVE badge
  await Act.updateOne(
    { _id: actId },
    { $set: { [`availabilityBadges.${key}`]: badge } }
  );

  console.log(`✅ Applied badge for ${actDoc.tscName || actDoc.name}`, { key });

  // SSE broadcast
  if (global.availabilityNotify?.badgeUpdated) {
    console.log("📡 SSE badgeUpdated fired", { actId, dateISO, slots: badge?.slots?.length || 0 });
    global.availabilityNotify.badgeUpdated({
      type: "availability_badge_updated",
      actId: String(actId),
      actName: actDoc?.tscName || actDoc?.name,
      dateISO,
      badge,
    });
  }

  // Client emails (wrap in try/catch so badge persistence never fails because of email)
  try {
    const allRows = availRows;
    const availabilityRecord = allRows
      .slice()
      .sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];

    let clientEmail =
      (allRows.find((r) => r.clientEmail && r.clientEmail.includes("@"))?.clientEmail) ||
      "hello@thesupremecollective.co.uk";
    let clientName = (allRows.find((r) => r.clientName)?.clientName) || "there";

 const SITE_RAW =
      process.env.FRONTEND_URL || "https://meek-biscotti-8d5020.netlify.app/";
    const SITE = SITE_RAW.endsWith("/") ? SITE_RAW : `${SITE_RAW}/`;

    const selectedAddress =
      badge?.address ||
      availabilityRecord?.formattedAddress ||
      actDoc?.formattedAddress ||
      actDoc?.venueAddress ||
      "TBC";

    const profileUrl = `${SITE}act/${actDoc._id}`;
    const cartUrl = `${SITE}act/${actDoc._id}?date=${dateISO}&address=${encodeURIComponent(selectedAddress)}`;

    const normKey = (s = "") => s.toString().toLowerCase().replace(/[^a-z]/g, "");
    const paMap = { smallpa: "small", mediumpa: "medium", largepa: "large" };
    const lightMap = { smalllight: "small", mediumlight: "medium", largelight: "large" };
    const paSize = paMap[normKey(actDoc.paSystem)];
    const lightSize = lightMap[normKey(actDoc.lightingSystem)];

    const setsA = Array.isArray(actDoc.numberOfSets) ? actDoc.numberOfSets : [actDoc.numberOfSets].filter(Boolean);
    const lensA = Array.isArray(actDoc.lengthOfSets) ? actDoc.lengthOfSets : [actDoc.lengthOfSets].filter(Boolean);
    const setsLine =
      setsA.length && lensA.length
        ? `Up to ${setsA[0]}×${lensA[0]}-minute or ${setsA[1] || setsA[0]}×${lensA[1] || lensA[0]}-minute live sets`
        : `Up to 3×40-minute or 2×60-minute live sets`;

    const complimentaryExtras = [];
    if (actDoc?.extras && typeof actDoc.extras === "object") {
      for (const [k, v] of Object.entries(actDoc.extras)) {
        if (v && v.complimentary) {
          complimentaryExtras.push(
            k.replace(/_/g, " ").replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
          );
        }
      }
    }

    const tailoring =
      actDoc.setlist === "smallTailoring"
        ? "Signature setlist curated by the band"
        : actDoc.setlist === "mediumTailoring"
        ? "Collaborative setlist (your top picks + band favourites)"
        : actDoc.setlist === "largeTailoring"
        ? "Fully tailored setlist built from your requests"
        : null;

    const lineupQuotes = await Promise.all(
      (actDoc.lineups || []).map(async (lu) => {
        try {
          const name =
            lu?.actSize ||
            `${(lu?.bandMembers || []).filter((m) => m?.isEssential).length}-Piece`;

          let travelTotal = "price TBC";
          try {
            const { county: selectedCounty } = countyFromAddress(selectedAddress);
            const { total } = await calculateActPricing(
              actDoc,
              selectedCounty,
              selectedAddress,
              dateISO,
              lu
            );
            if (total && !isNaN(total)) {
              travelTotal = `£${Math.round(Number(total)).toLocaleString("en-GB")}`;
            }
          } catch (err) {
            console.warn("⚠️ [rebuildAndApplyAvailabilityBadge] Price calc failed:", err.message);
          }

          const instruments = (lu?.bandMembers || [])
            .filter((m) => m?.isEssential)
            .map((m) => m?.instrument)
            .filter(Boolean)
            .join(", ");

          return { html: `<strong>${name}</strong>: ${instruments} — <strong>${travelTotal}</strong>` };
        } catch (err) {
          console.warn("⚠️ [rebuildAndApplyAvailabilityBadge] Lineup formatting failed:", err.message);
          return { html: "<em>Lineup unavailable</em>" };
        }
      })
    );

    // ──────────────────────────────────────────────────────────────
// Derive leadSlot & deputySlot from the badge for email logic
// ──────────────────────────────────────────────────────────────
const slotsArr = Array.isArray(badge?.slots) ? badge.slots : [];

const isHttp = (u) => typeof u === "string" && u.startsWith("http");

// A "lead available" slot: slot itself says yes AND we're not showing a deputy,
// or the primary is explicitly not a deputy and has a usable photo.
const isLeadAvailableSlot = (s) => {
  const leadSaysYes = s?.state === "yes" && s?.covering !== "deputy";
  const primaryIsLead =
    s?.primary && s.primary.isDeputy === false &&
    (s.primary.available === true || s?.state === "yes") &&
    (isHttp(s?.primary?.photoUrl) || isHttp(s?.photoUrl));
  return !!(leadSaysYes || primaryIsLead);
};

// A "deputy covering" slot: either the slot is marked as deputy cover with a deputy
// primary that has a photo, or any deputy replied yes with a photo.
const isDeputyCoveringSlot = (s) => {
  const primaryDeputyCover =
    s?.covering === "deputy" &&
    s?.primary?.isDeputy === true &&
    isHttp(s?.primary?.photoUrl);

  const yesDeputyWithPhoto = Array.isArray(s?.deputies) &&
    s.deputies.some((d) => d?.state === "yes" && isHttp(d?.photoUrl));

  return !!(primaryDeputyCover || yesDeputyWithPhoto);
};

const leadSlot   = slotsArr.find(isLeadAvailableSlot)   || null;
const deputySlot = slotsArr.find(isDeputyCoveringSlot) || null;

// Pick a presentable "primary" person from a slot (lead or deputy cover)
const presentBadgePrimary = (slot = null) => {
  if (!slot || typeof slot !== "object") return null;

  const isHttp = (u) => typeof u === "string" && u.startsWith("http");

  // Choose the candidate we want to present
  let candidate = null;
  let isDeputy = false;

  // If a deputy is covering, prefer a YES deputy with a valid photo
  if (slot.covering === "deputy") {
    if (Array.isArray(slot.deputies)) {
      const yesDep = slot.deputies.find((d) => d?.state === "yes" && isHttp(d?.photoUrl));
      if (yesDep) {
        candidate = yesDep;
        isDeputy = true;
      }
    }
    if (!candidate && slot?.primary?.isDeputy && isHttp(slot?.primary?.photoUrl)) {
      candidate = slot.primary;
      isDeputy = true;
    }
    if (!candidate && Array.isArray(slot.deputies)) {
      const anyDep = slot.deputies.find((d) => isHttp(d?.photoUrl));
      if (anyDep) {
        candidate = anyDep;
        isDeputy = true;
      }
    }
  }

  // Otherwise, prefer the lead
  if (!candidate) {
    if (slot?.primary && slot.primary.isDeputy === false && isHttp(slot.primary.photoUrl)) {
      candidate = slot.primary;
      isDeputy = false;
    } else if (isHttp(slot?.photoUrl)) {
      candidate = slot;
      isDeputy = false;
    }
  }

  if (!candidate) return null;

  const rawName =
    candidate.vocalistName ||
    candidate.displayName ||
    candidate.preferredName ||
    candidate.name ||
    "";

  const nameStr =
    typeof rawName === "string" && rawName.trim()
      ? rawName.trim()
      : pickDisplayName(candidate); // fallback using your earlier helper

  const { firstName, lastName, displayName } = safeFirstLast(nameStr);

  return {
    musicianId: candidate.musicianId || null,
    first: firstName,           // keep legacy fields if you log them
    last: lastName,
    firstName,
    lastName,
    displayName,
    vocalistDisplayName: nameStr,
    photoUrl: candidate.photoUrl || null,
    profileUrl: candidate.profileUrl || "",
    isDeputy,
    phone: null,
    setAt: candidate.setAt || slot.setAt || null,
    available:
      candidate.available === true ||
      candidate.state === "yes" ||
      slot.state === "yes",
    slotIndex: slot.slotIndex ?? null,
  };
};

    const leadPrimary = leadSlot ? presentBadgePrimary(leadSlot) : null;
    const depPrimary = deputySlot ? presentBadgePrimary(deputySlot) : null;

    console.log("✉️ [rebuildAndApplyAvailabilityBadge] Email decision context", {
      clientName,
      clientEmail,
      selectedAddress,
      leadPrimary,
      deputyPrimary: depPrimary,
    });

    // Lazy import (if you use this util)
    let sendClientEmail = null;
  

    const heroImg =
      (Array.isArray(actDoc.coverImage) && actDoc.coverImage[0]?.url) ||
      (Array.isArray(actDoc.images) && actDoc.images[0]?.url) ||
      actDoc.coverImage?.url ||
      "";

    if (sendClientEmail) {
      // Lead available → good-news email
      if (leadPrimary?.available && leadPrimary?.isDeputy === false) {
        const vocalistFirst = leadPrimary.firstName || "our lead vocalist";
        console.log("📧 [rebuildAndApplyAvailabilityBadge] Sending LEAD-available email", {
          vocalistFirst,
          to: clientEmail,
        });

        await sendClientEmail({
          actId: String(actId),
          subject: `Good news — ${(actDoc.tscName || actDoc.name)}'s lead vocalist is available`,
          to: clientEmail,
          name: clientName,
          html: `
            <div style="font-family: Arial, sans-serif; color:#333; line-height:1.6; max-width:700px; margin:0 auto;">
              <p>Hi ${(clientName || "there").split(" ")[0]},</p>
              <p>Thank you for shortlisting <strong>${actDoc.tscName || actDoc.name}</strong>!</p>
              <p>
                We’re delighted to confirm that <strong>${actDoc.tscName || actDoc.name}</strong> is available with
                <strong>${vocalistFirst}</strong> on lead vocals, and they’d love to perform for you and your guests.
              </p>
              ${heroImg ? `<img src="${heroImg}" alt="${actDoc.tscName || actDoc.name}" style="width:100%; border-radius:8px; margin:20px 0;" />` : ""}
              <h3 style="color:#111;">🎵 ${actDoc.tscName || actDoc.name}</h3>
              <p style="margin:6px 0 14px; color:#555;">${actDoc.tscDescription || actDoc.description || ""}</p>
              <p><a href="${profileUrl}" style="color:#ff6667; font-weight:600;">View Profile →</a></p>
              ${lineupQuotes.length ? `<h4 style="margin-top:20px;">Lineup options:</h4><ul>${lineupQuotes.map(l => `<li>${l.html}</li>`).join("")}</ul>` : ""}
              <h4 style="margin-top:25px;">Included in your quote:</h4>
              <ul>
                <li>${setsLine}</li>
                ${paSize ? `<li>A ${paSize} PA system${lightSize ? ` and a ${lightSize} lighting setup` : ""}</li>` : ""}
                <li>Band arrival from 5pm and finish by midnight as standard</li>
                <li>Or up to 7 hours on site if earlier arrival is needed</li>
                ${complimentaryExtras.map((x) => `<li>${x}</li>`).join("")}
                ${tailoring ? `<li>${tailoring}</li>` : ""}
                <li>Travel to ${selectedAddress.split(",").slice(0,2).join(", ") || "TBC"}</li>
              </ul>
              <div style="margin-top:30px;">
                <a href="${cartUrl}" style="background-color:#ff6667; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:600;">Book Now →</a>
              </div>
            </div>
          `,
        });

        console.log("✅ [rebuildAndApplyAvailabilityBadge] Client email sent (lead available).");
      }
      // Deputy covering → deputy-available email
      else if (depPrimary?.available && depPrimary?.isDeputy === true) {
        const deputyName = depPrimary.displayName || depPrimary.firstName || "one of our vocalists";
        console.log("📧 [rebuildAndApplyAvailabilityBadge] Sending DEPUTY-available email", {
          deputyName,
          to: clientEmail,
        });

        // Try to enrich deputy media/profile
        let deputyPhotoUrl = depPrimary.photoUrl || "";
        let deputyProfileUrl = depPrimary.profileUrl || "";
        let deputyVideos = [];
        try {
          let deputyMusician = null;
          if (depPrimary?.musicianId) {
            deputyMusician = await Musician.findById(depPrimary.musicianId)
              .select("firstName lastName profilePicture photoUrl tscProfileUrl functionBandVideoLinks originalBandVideoLinks")
              .lean();
          }
          if (deputyMusician) {
            if (!deputyPhotoUrl)
              deputyPhotoUrl = deputyMusician.profilePicture || deputyMusician.photoUrl || "";
            if (!deputyProfileUrl)
              deputyProfileUrl = deputyMusician.tscProfileUrl || `${SITE}musician/${deputyMusician._id}`;

            const fnVids = (deputyMusician.functionBandVideoLinks || []).filter(v => v?.url).map(v => v.url);
            const origVids = (deputyMusician.originalBandVideoLinks || []).filter(v => v?.url).map(v => v.url);
            deputyVideos = [...new Set([...fnVids, ...origVids])];
          }
        } catch (e) {
          console.warn("⚠️ [rebuildAndApplyAvailabilityBadge] Deputy enrichment failed:", e?.message || e);
        }

        await sendClientEmail({
          actId: String(actId),
          subject: `${deputyName} is raring to step in and perform for you with ${actDoc.tscName || actDoc.name}`,
          to: clientEmail,
          name: clientName,
          html: `
            <div style="font-family: Arial, sans-serif; color:#333; line-height:1.6; max-width:700px; margin:0 auto;">
              <p>Hi ${(clientName || "there").split(" ")[0]},</p>
              <p>Thank you for shortlisting <strong>${actDoc.tscName || actDoc.name}</strong>!</p>
              <p>
                The band's regular lead vocalist isn’t available for your date, but we’re delighted to confirm that 
                <strong>${deputyName}</strong> — one of the band's trusted deputy vocalists — is available to perform instead.
              </p>
              ${
                deputyProfileUrl || deputyPhotoUrl
                  ? `<div style="margin:20px 0; border-top:1px solid #eee; padding-top:15px;">
                       <h3 style="color:#111; margin-bottom:10px;">Introducing ${deputyName}</h3>
                       ${deputyPhotoUrl ? `<img src="${deputyPhotoUrl}" alt="${deputyName}" style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px;" />` : ""}
                     </div>`
                  : ""
              }
              ${
                deputyVideos?.length
                  ? `<div style="margin-top:25px;">
                       <h4 style="color:#111;">🎬 Watch ${deputyName} perform</h4>
                       <ul style="list-style:none; padding-left:0;">
                         ${deputyVideos.slice(0,3).map((v) => `<li style="margin-bottom:8px;"><a href="${v}" target="_blank" style="color:#ff6667;">${v}</a></li>`).join("")}
                       </ul>
                     </div>`
                  : ""
              }
              ${heroImg ? `<img src="${heroImg}" alt="${actDoc.tscName || actDoc.name}" style="width:100%; border-radius:8px; margin:20px 0;" />` : ""}
              <p><a href="${deputyProfileUrl || profileUrl}" style="color:#ff6667; font-weight:600;">View Profile →</a></p>
              ${lineupQuotes.length ? `<h4 style="margin-top:20px;">Lineup options:</h4><ul>${lineupQuotes.map(l => `<li>${l.html}</li>`).join("")}</ul>` : ""}
              <div style="margin-top:30px;">
                <a href="${cartUrl}" style="background-color:#ff6667; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:600;">Book Now →</a>
              </div>
            </div>
          `,
        });

        console.log("✅ [rebuildAndApplyAvailabilityBadge] Deputy-available client email sent.");
      }
    }
  } catch (e) {
    console.warn("⚠️ [rebuildAndApplyAvailabilityBadge] Client email block failed:", e?.message || e);
  }

  return { success: true, updated: true, badge };
}

export async function getAvailabilityBadge(req, res) {
  try {
    const { actId, dateISO } = req.params;
    console.log("🎯 [getAvailabilityBadge] Fetching badge for:", {
      actId,
      dateISO,
    });

    if (!actId || !dateISO) {
      return res.status(400).json({ error: "Missing actId or dateISO" });
    }

    const act = await Act.findById(actId)
      .select("formattedAddress lineups")
      .lean();
    if (!act) {
      return res.status(404).json({ error: "Act not found" });
    }

    // 🚫 Skip rebuild if lead marked unavailable
    const actDoc = await Act.findById(actId).lean();
    if (actDoc?.availabilityBadgesMeta?.[dateISO]?.lockedByLeadUnavailable) {
      console.log(`⏭️ Skipping rebuild — lead unavailable lock active for ${dateISO}`);
      return res.json({ badge: null, skipped: true, reason: "lead_unavailable_lock" });
    }

    const badge = await buildAvailabilityBadgeFromRows({
      actId,
      dateISO,
      hasLineups: actDoc?.hasLineups ?? true,
    });
    if (!badge) {
      console.log("🪶 No badge found for act/date:", { actId, dateISO });
      return res.json({ badge: null });
    }

    console.log("✅ [getAvailabilityBadge] Returning badge:", badge);
    return res.json({ badge });
  } catch (err) {
    console.error("❌ [getAvailabilityBadge] Error:", err);
    res.status(500).json({ error: err.message });
  }
}
