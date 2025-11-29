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

async function findCanonicalMusicianByPhone(phoneLike) {
  if (!phoneLike) return null;
  const p = normalize44(phoneLike);
  return await Musician.findOne({
    $or: [
      { phoneNormalized: p },
      { phone: p },
      { phoneNumber: p },
      { 'contact.phone': p },
      { whatsappNumber: p },
    ],
  })
  .select('_id firstName lastName email profilePicture musicianProfileImage profileImage photoUrl imageUrl phoneNormalized')
  .lean();
}

function pickPic(mus) {
  return (
    mus?.profilePicture ||
    mus?.musicianProfileImage ||
    mus?.profileImage ||
    mus?.photoUrl ||
    mus?.imageUrl ||
    ''
  );
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
export async function sendClientEmail({ actId, to, name, subject, html }) {
  try {
    const act = await Act.findById(actId).lean();

    const recipient =
      (to && to !== "hello@thesupremecollective.co.uk") ? to :
      (act?.contactEmail && act.contactEmail !== "hello@thesupremecollective.co.uk") ? act.contactEmail :
      process.env.NOTIFY_EMAIL ||
      "hello@thesupremecollective.co.uk";


    if (!recipient || recipient === "hello@thesupremecollective.co.uk") {
      console.warn("⚠️ No valid client recipient found, skipping sendEmail");
      return { success: false, skipped: true };
    }

    // ✅ Correct positional call
    await sendEmail(
      recipient,
      subject,
      html,
      "hello@thesupremecollective.co.uk"
    );

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
function getCountyFeeValue(countyFees, countyName) {
  console.log(
    `🟢 (availabilityController.js) getCountyFeeValue  START at ${new Date().toISOString()}`,
    {}
  );
  if (!countyFees || !countyName) return undefined;

  // Normalized compare: "Berkshire" === "berkshire" === "berk_shire"
  const want = normCountyKey(countyName); // e.g. "berkshire"

  // Map support
  if (typeof countyFees.get === "function") {
    for (const [k, v] of countyFees) {
      if (normCountyKey(k) === want) return v;
    }
    return undefined;
  }

  // Plain object support
  // 1) quick direct hits
  if (countyFees[countyName] != null) return countyFees[countyName];
  if (countyFees[want] != null) return countyFees[want];
  const spaced = countyName.replace(/_/g, " ");
  if (countyFees[spaced] != null) return countyFees[spaced];

  // 2) case-insensitive scan
  for (const [k, v] of Object.entries(countyFees)) {
    if (normCountyKey(k) === want) return v;
  }
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

export function countyFromAddress(address = "") {
  console.log(
    `🟢 (availabilityController.js) countyFromAddress START at ${new Date().toISOString()}`,
    {}
  );
  // pull something like SL6, W1, SW1A from the address
  const outcode = extractOutcode(address).toUpperCase();
  if (!outcode) return { outcode: "", county: "" };

  // your export is: export const postcodes = [ { county: [OUTCODES...] } ];
  const table = Array.isArray(postcodes) ? postcodes[0] || {} : postcodes || {};

  let found = "";
  for (const [countyKey, list] of Object.entries(table)) {
    if (Array.isArray(list) && list.includes(outcode)) {
      // normalise snake_case keys from the file into human names
      found = countyKey.replace(/_/g, " ").trim();
      break;
    }
  }

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


export async function notifyDeputies({
  actId,
  lineupId,
  dateISO,
  formattedAddress,
  clientName,
  clientEmail,
  slotIndex = null,          // 👈 NEW — only trigger for the vocalist slot that went unavailable
  skipDuplicateCheck = false,
  skipIfUnavailable = true,
}) {
  console.log(`📢 [notifyDeputies] START — act ${actId}, date ${dateISO}, slotIndex ${slotIndex}`);

  // 🔹 Lookup act + lineup
  const act = await Act.findById(actId).lean();
  if (!act) return console.warn("⚠️ No act found for notifyDeputies()");
  const lineup = act?.lineups?.find((l) => String(l._id) === String(lineupId));
  if (!lineup) return console.warn("⚠️ No lineup found for notifyDeputies()");

  // 🎤 Identify all vocalists
  const vocalists = lineup.bandMembers?.filter((m) =>
    ["vocal", "vocalist"].some((v) => (m.instrument || "").toLowerCase().includes(v))
  ) || [];

  if (!vocalists.length) return console.warn("⚠️ No vocalists found in lineup.");

  // 🧩 Determine which vocalist(s) to target
  const targetVocalists =
    slotIndex !== null && vocalists[slotIndex]
      ? [vocalists[slotIndex]]
      : vocalists;

  console.log(`🎯 Targeting ${targetVocalists.length} vocalist(s) for deputy notification.`);

  // 🧩 Find corresponding lead availability for inherited fee
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
      console.log(`💾 Found existing lead fee: £${inheritedFee}`);
    }
  } catch (err) {
    console.warn("⚠️ Could not fetch lead fee:", err.message);
  }

  if (!inheritedFee && targetVocalists[0]?.fee) {
    inheritedFee = Number(targetVocalists[0].fee);
    console.log(`💾 Fallback fee from act data: £${inheritedFee}`);
  }

  // 🧮 Build exclusion list of already-contacted / unavailable phones
  const existingPhonesAgg = await AvailabilityModel.aggregate([
    {
      $match: {
        actId,
        dateISO,
        reply: { $in: ["yes", "unavailable"] },
      },
    },
    { $group: { _id: "$phone" } },
  ]);
  const existingSet = new Set(existingPhonesAgg.map((p) => (p._id || "").replace(/\s+/g, "")));

  // 🧱 Limit tracking per slot
  let totalSent = 0;

  for (const vocalist of targetVocalists) {
    for (const deputy of vocalist.deputies || []) {
      const cleanPhone = (deputy.phoneNumber || deputy.phone || "").replace(/\s+/g, "");
      if (!/^\+?\d{10,15}$/.test(cleanPhone)) continue;
      if (existingSet.has(cleanPhone)) continue;

      console.log(`🎯 Sending deputy enquiry to ${deputy.firstName || deputy.name} (slot ${slotIndex ?? "?"})`);

      // --- Insert displayName helpers for deputy/vocalist ---
      const displayNameOf = (p = {}) => {
        const fn = (p.firstName || p.name || "").trim();
        const ln = (p.lastName || "").trim();
        return (fn && ln) ? `${fn} ${ln}` : (fn || ln || "");
      };
      const deputyDisplayName = displayNameOf(deputy);
      const vocalistDisplayName = displayNameOf(vocalist);

      await triggerAvailabilityRequest({
        actId,
        lineupId,
        dateISO,
        slotIndex, // 👈 make sure we pass it through
        formattedAddress,
        clientName,
        clientEmail,

        isDeputy: true,                      // 👈 hard-assert deputy
        selectedVocalistName: deputyDisplayName || vocalistDisplayName || "",
        vocalistName: vocalistDisplayName || "",
        deputy: {                            // normalize the deputy payload we send
          id: deputy.id || deputy.musicianId || deputy._id || null,
          musicianId: deputy.musicianId || deputy.id || deputy._id || null,
          firstName: deputy.firstName || deputy.name || "",
          lastName: deputy.lastName || "",
          phone: cleanPhone,                 // normalized above
          email: deputy.email || "",
          imageUrl: deputy.imageUrl || deputy.photoUrl || null,
          displayName: deputyDisplayName || "",
        },

        inheritedFee,
        inheritedDuties: vocalist.instrument || "Vocalist",
        skipDuplicateCheck,
      });

      existingSet.add(cleanPhone);
      totalSent++;
      if (totalSent >= 3) {
        console.log("🛑 Limit reached (3 deputies contacted)");
        return;
      }
    }
  }

  console.log(`✅ [notifyDeputies] Complete — deputies contacted: ${totalSent}`);
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

function findVocalistPhone(actData, lineupId) {
  console.log(
    `🐠 (controllers/shortlistController.js) findVocalistPhone called at`,
    new Date().toISOString(),
    { lineupId, totalLineups: actData?.lineups?.length || 0 }
  );

  if (!actData?.lineups?.length) return null;

  // Prefer specified lineupId
  const lineup = lineupId
    ? actData.lineups.find(
        (l) => String(l._id || l.lineupId) === String(lineupId)
      )
    : actData.lineups[0];

  if (!lineup?.bandMembers?.length) return null;

  // 🎤 Step 1: Find the lead vocalist (or first vocalist)
  const vocalist = lineup.bandMembers.find((m) =>
    String(m.instrument || "").toLowerCase().includes("vocal")
  );

  if (!vocalist) {
    console.warn("⚠️ No vocalist found in lineup", lineupId);
    return null;
  }

  // 🎤 Step 2: Try to get a direct phone number
  let phone =
    vocalist.phoneNormalized ||
    vocalist.phoneNumber ||
    vocalist.phone ||
    "";

  // 🎤 Step 3: If no phone for lead, check deputies
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
      console.log(
        `🎯 Using deputy phone (${deputyWithPhone.firstName || deputyWithPhone.name}) for ${vocalist.firstName}`
      );
    }
  }

  // 🎤 Step 4: Normalize to E.164 if needed
  phone = toE164(phone);

  if (!phone) {
    console.warn("⚠️ No valid phone found for vocalist or deputies:", {
      vocalist: `${vocalist.firstName} ${vocalist.lastName}`,
      lineup: lineup.actSize,
      act: actData.tscName || actData.name,
    });
    return null;
  }

  console.log("🎤 Lead vocalist found (with deputy fallback):", {
    name: `${vocalist.firstName} ${vocalist.lastName}`,
    instrument: vocalist.instrument,
    fee: vocalist.fee,
    phone,
    email: vocalist.email,
  });

  // ✅ Return full object
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


// controllers/availabilityController.js
export const triggerAvailabilityRequest = async (reqOrArgs, maybeRes) => {
  const isExpress = !!maybeRes;
  const body = isExpress ? reqOrArgs.body : reqOrArgs;
  const res = isExpress ? maybeRes : null;

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

    const slotIndexBase = existingForEnquiry.length; // (kept for reference)
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

    let shortAddress =
      formattedAddress || address || act?.formattedAddress || "TBC";
    shortAddress = shortAddress
      .split(",")
      .slice(-2)
      .join(",")
      .replace(/,\s*UK$/i, "")
      .trim();

    const fullFormattedAddress =
      formattedAddress || address || act?.formattedAddress || act?.venueAddress || "TBC";

    const formattedDate = new Date(dateISO).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
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
    /* 🔢 Normalise phone                                             */
    /* -------------------------------------------------------------- */
    const normalizePhone = (raw = "") => {
      let v = String(raw || "").replace(/\s+/g, "").replace(/^whatsapp:/i, "");
      if (!v) return "";
      if (v.startsWith("+")) return v;
      if (v.startsWith("07")) return v.replace(/^0/, "+44");
      if (v.startsWith("44")) return `+${v}`;
      return v;
    };

    // 🔎 Rough address matcher (treats "City, County" vs full-line equivalently; ignores case/extra spaces/"UK")
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

        // 🧯 PRIOR-REPLY CHECK (per-slot) — if this vocalist already replied for SAME date+location, don't message again.
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

            // ✅ If lead previously UNAVAILABLE/NO, immediately notify deputies for this slot
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

            // ✅ If lead previously YES, refresh badge (optional best-effort)
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

            // Record into results for parity with the loop, but mark as reused
            results.push({
              name: vMember.firstName,
              slotIndex: slotIndexForThis,
              phone,
              reusedExisting: true,
              existingReply: prior.reply,
            });
            continue; // ⬅️ move to next vocalist without sending
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
        };
       const displayNameForLead = `${enriched.firstName || vMember.firstName || ""} ${enriched.lastName || vMember.lastName || ""}`.trim();

const setAlways = {
  isDeputy: false,
  musicianId: realMusicianId,                  // ✅ ensure row is linked
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
  // ✅ new: carry the *same* name into modern fields
  selectedVocalistName: displayNameForLead,
  selectedVocalistId: realMusicianId || null,
  vocalistName: displayNameForLead,
};

        const savedLead = await AvailabilityModel.findOneAndUpdate(
          query,
          { $setOnInsert: setOnInsert, $set: setAlways },
          { new: true, upsert: true }
        );

        console.log("✅ Upserted LEAD row", {
          slot: slotIndexForThis,
          isDeputy: savedLead?.isDeputy,
          musicianId: String(savedLead?.musicianId || ""),
        });

        const msg = `Hi ${vMember.firstName || "there"}, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress} at a rate of £${finalFee} for ${vMember.instrument} duties with ${act.tscName || act.name}. Please indicate your availability 💫`;

        await sendWhatsAppMessage({
          to: phone,
          actData: act,
          lineup: lineup || {},
          member: vMember,
          address: shortAddress,
          dateISO,
          role: vMember.instrument,
          variables: {
            firstName: vMember.firstName || "Musician", // we get the first name here
            date: formattedDate,
            location: shortAddress,
            fee: String(finalFee),
            role: vMember.instrument,
            actName: act.tscName || act.name,
          },
          contentSid: process.env.TWILIO_ENQUIRY_SID,
          smsBody: msg,
        });

        results.push({ name: vMember.firstName, slotIndex: slotIndexForThis, phone });
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

    // Preferred display name to carry through toasts/cart
    const selectedName = String(
      selectedVocalistName ||
      canonicalName ||
      `${targetMember?.firstName || ""} ${targetMember?.lastName || ""}`
    ).trim();
    /* -------------------------------------------------------------- */
    /* 🛡️ Prior-reply check (same date + same location)               */
    /*     If we already have a YES/NO/UNAVAILABLE for this member    */
    /*     on the same date and location, DO NOT message again.       */
    /*     Instead, proceed as if that reply just occurred.           */
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
        // ✅ Refresh badge (best-effort)
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
        // ✅ Lead previously unavailable — trigger deputies now
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

      // Return without sending any new message
      if (res) return res.json({ success: true, sent: 0, usedExisting: prior.reply });
      return { success: true, sent: 0, usedExisting: prior.reply };
    }

    /* -------------------------------------------------------------- */
    /* 🔐 Refined duplicate guard                                     */
    /*     If a row exists but has NO reply yet, keep legacy          */
    /*     behaviour for leads (skip re-send unless explicitly        */
    /*     allowed via skipDuplicateCheck); for deputies scope by     */
    /*     slotIndex to avoid cross-slot collisions.                  */
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
      // Keep the legacy behaviour for lead re-sends; deputies are handled by scoped guard above.
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
  musicianId: canonicalId,        // ✅ insert with canonical musician id
  selectedVocalistName: selectedName,
  selectedVocalistId: canonicalId || null,
};
  const PUBLIC_SITE_BASE = (
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5174"
  ).replace(/\/$/, "");


const setAlways = {
  isDeputy: !!isDeputy,
  musicianName: canonicalName,    // ✅ name from canonical
  musicianEmail: canonical?.email || targetMember.email || "",
  photoUrl: canonicalPhoto,       // ✅ photo from canonical
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
};

const saved = await AvailabilityModel.findOneAndUpdate(
  query,
  { $setOnInsert: setOnInsert, $set: setAlways },
  { new: true, upsert: true }
);

console.log(`✅ Upserted ${isDeputy ? "DEPUTY" : "LEAD"} row`, {
  slot: singleSlotIndex,
  isDeputy: saved?.isDeputy,
  musicianId: String(saved?.musicianId || ""),
});

    /* -------------------------------------------------------------- */
    /* 💬 Send WhatsApp                                               */
    /* -------------------------------------------------------------- */
    const role = body?.inheritedDuties || targetMember.instrument || "Performance";
    const feeStr = finalFee > 0 ? `£${finalFee}` : "TBC";

    const msg = `Hi ${targetMember.firstName || "there"}, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress} at a rate of ${feeStr} for ${role} duties with ${act.tscName || act.name}. Please indicate your availability 💫`;

    console.log("🐛 About to call sendWhatsAppMessage()");
    await sendWhatsAppMessage({
      to: phone,
      actData: act,
      lineup: lineup || {},
      member: targetMember,
      address: shortAddress,
      dateISO,
      role,
      variables: {
        firstName: targetMember.firstName || "Musician",
        date: formattedDate,
        location: shortAddress,
        fee: String(finalFee),
        role,
        actName: act.tscName || act.name,
      },
      contentSid: process.env.TWILIO_ENQUIRY_SID,
      smsBody: msg,
    });

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


export const twilioInbound = async (req, res) => {
  console.log(`🟢 [twilioInbound] START at ${new Date().toISOString()}`);

  // ✅ Immediately acknowledge Twilio to prevent retries
  res.status(200).send("OK");
// Resolve a human-friendly display name from row + musician doc
const resolveDisplayName = (row, musician) => {
  const fromRow =
    (row?.selectedVocalistName || row?.vocalistName || row?.musicianName || "").trim();
  if (fromRow) return fromRow;

  const fromMus = `${musician?.firstName || ""} ${musician?.lastName || ""}`.trim();
  return fromMus || "Vocalist";
};

  setImmediate( () => {
    (async () => {
    try {

      

      const bodyText = String(req.body?.Body || "");
      const buttonText = String(req.body?.ButtonText || "");
      const buttonPayload = String(req.body?.ButtonPayload || "");
      const inboundSid = String(req.body?.MessageSid || "");
      const fromRaw = String(req.body?.WaId || req.body?.From || "").replace(/^whatsapp:/i, "");

      const noContent = !buttonPayload && !buttonText && !bodyText;
      if (noContent) return console.log("🪵 Ignoring empty inbound message", { From: fromRaw });

      if (seenInboundOnce(inboundSid)) {
        console.log("🪵 Duplicate inbound — already handled", { MessageSid: inboundSid });
        return;
      }

      let { reply, enquiryId } = parsePayload(buttonPayload);
      if (!reply) reply = classifyReply(buttonText) || classifyReply(bodyText) || null;
      if (!reply) return;

      // --- Find matching availability row ---
      let updated = null;
      if (enquiryId) {
        updated = await AvailabilityModel.findOneAndUpdate(
          { enquiryId },
          { $set: { reply, repliedAt: new Date(), "inbound.sid": inboundSid } },
          { new: true }
        );
      }
      if (!updated) {
        updated = await AvailabilityModel.findOneAndUpdate(
          { phone: normalizeFrom(fromRaw) },
          { $set: { reply, repliedAt: new Date(), "inbound.sid": inboundSid } },
          { sort: { createdAt: -1 }, new: true }
        );
      }

      if (!updated) {
        console.warn("⚠️ No matching AvailabilityModel found for inbound reply.");
        return;
      }
// Resolve canonical Musician by the deputy’s phone (preferred) or the row’s id
const byPhone = await findCanonicalMusicianByPhone(updated.phone);
let musician = byPhone || (updated?.musicianId ? await Musician.findById(updated.musicianId).lean() : null);

// If the availability row still carries the ACT-collection id, fix it to the canonical Musicians id
if (updated.isDeputy && musician && String(updated.musicianId) !== String(musician._id)) {
  await AvailabilityModel.updateOne(
    { _id: updated._id },
    {
      $set: {
        musicianId: musician._id,
        musicianName: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
        musicianEmail: musician.email || updated.musicianEmail || "",
        photoUrl: pickPic(musician),
        profileUrl: `${BASE_URL}/musician/${musician._id}`,
      },
    }
  );

  // keep in-memory copy in sync for the rest of this handler
  updated.musicianId = musician._id;
  updated.musicianName = `${musician.firstName || ""} ${musician.lastName || ""}`.trim();
  updated.musicianEmail = musician.email || updated.musicianEmail;
  updated.photoUrl = pickPic(musician) || updated.photoUrl;
}

const displayName = resolveDisplayName(updated, musician);

// Make sure the Availability row carries a stable vocalistName
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
  updated.vocalistName = displayName; // keep in-memory copy in sync
  if (!updated.musicianName) updated.musicianName = displayName;
}

      // 🧩 Debug + ensure slotIndex is available for deputy notifications
const slotIndex = typeof updated.slotIndex === "number" ? updated.slotIndex : null;
console.log("🎯 [twilioInbound] Matched slotIndex:", slotIndex);


const isDeputy = Boolean(updated?.isDeputy);

// If this row should be a deputy row but the flag isn't persisted yet, persist it.
if (isDeputy && updated?.isDeputy !== true) {
  await AvailabilityModel.updateOne(
    { _id: updated._id },
    { $set: { isDeputy: true } }
  );
  updated.isDeputy = true;
}

// 🔍 Ensure we always have musician data (lead or deputy)
if (!musician && updated?.musicianId) {
  musician = await Musician.findById(updated.musicianId).lean();
}

if (!musician && updated?.musicianName) {
  musician = await Musician.findOne({
    $or: [
      { name: updated.musicianName },
      { firstName: new RegExp(updated.musicianName.split(" ")[0], "i") },
      { lastName: new RegExp(updated.musicianName.split(" ").slice(-1)[0], "i") },
    ],
  })
    .select("email firstName lastName musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl _id")
    .lean();
}

// 🔹 use musician (for deputies) or updated (for lead) directly
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

        // 🧭 Always resolve Act regardless of how actId is stored
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
      console.log(`📩 Twilio Inbound (${reply?.toUpperCase?.() || "UNKNOWN"}) for ${act?.tscName || "Unknown Act"}`);
      console.log(`👤 ${musician?.firstName || updated?.musicianName || "Unknown Musician"}`);
      console.log(`📅 ${updated?.dateISO || "Unknown Date"}`);
      console.log(`📧 ${emailForInvite}`);
      console.log("──────────────────────────────────────────────");
      /* ---------------------------------------------------------------------- */
      /* ✅ YES BRANCH (Lead or Deputy)                                         */
      /* ---------------------------------------------------------------------- */
      
      if (reply === "yes") {
        console.log(`✅ YES reply received via WhatsApp (${isDeputy ? "Deputy" : "Lead"})`);

        const { createCalendarInvite } = await import("./googleController.js");

        // 1️⃣ Create a calendar invite for either lead or deputy
        console.log("📧 [Calendar Debug] emailForInvite=", emailForInvite, "act=", !!act, "dateISO=", dateISO);
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
            // 🧹 Cancel any existing calendar event before re-creating a new one
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

            const event = await createCalendarInvite(
              {
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

            // ✅ move this INSIDE the try
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

        await sendWhatsAppText(toE164, "Super — we’ll send a diary invite to log the enquiry for your records.");

        // 2️⃣ Mark as available + rebuild badge
        await AvailabilityModel.updateOne(
          { _id: updated._id },
          { $set: { status: "read", ...(isDeputy ? { isDeputy: true } : {}) } }
        );

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

        // 3️⃣ Broadcast SSE updates
        if (global.availabilityNotify) {
          if (isDeputy) {
            global.availabilityNotify.deputyYes({
              actId,
              actName: act?.tscName || act?.name,
              musicianName: displayName,  // ✅ use resolved name
              dateISO,
              musicianId: musician?._id || updated?.musicianId || null,
              badge: badgeResult?.badge,
            });
          } else {
            global.availabilityNotify.leadYes({
              actId,
              actName: act?.tscName || act?.name,
              musicianName: displayName,  // ✅ use resolved name
              dateISO,
              musicianId: musician?._id || updated?.musicianId || null,
            });
          }

          if (badgeResult?.badge) {
            global.availabilityNotify.badgeUpdated({
              actId,
              actName: act?.tscName || act?.name,
              dateISO,
              badge: badgeResult.badge,
            });
          }
        }

        // ⭐ Lead branch
        if (!isDeputy) {
          const leadName =
            musician?.firstName ||
            updated?.musicianName ||
            updated?.name ||
            "Lead Vocalist";

          global.availabilityNotify.leadYes({
            actId,
            actName: act?.tscName || act?.name,
            musicianName: leadName,         // ✅ feed the name through
            dateISO,
            musicianId: musician?._id || updated?.musicianId || null,
          });
        }

        // 🎤 Live badge refresh (lead or deputy) — keep this as-is
        if (badgeResult?.badge) {
          global.availabilityNotify.badgeUpdated({
            actId,
            actName: act?.tscName || act?.name,
            dateISO,
            badge: badgeResult.badge,       // ✅ badge goes here
          });
        }

        console.log("📡 SSE broadcasted: availability_badge_updated");
        return;
      } // ← closes YES branch

// 🚫 NO / UNAVAILABLE / NOLOC BRANCH
        if (["no", "unavailable", "noloc", "nolocation"].includes(reply)) {
          console.log("🚫 UNAVAILABLE reply received via WhatsApp");

          await AvailabilityModel.updateMany(
            {
              musicianEmail: emailForInvite.toLowerCase(),
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

          // 🗓️ Cancel the shared event
          try {
            await cancelCalendarInvite({
              eventId: updated.calendarEventId,
              dateISO: updated.dateISO,
              email: emailForInvite,
            });
          } catch (err) {
            console.error("❌ Failed to cancel shared event:", err.message);
          }

          // 🗑️ Clear any active badge
          try {
            const unset = {
              [`availabilityBadges.${dateISO}`]: "",
              [`availabilityBadges.${dateISO}_tbc`]: "",
            };
            await Act.updateOne({ _id: actId }, { $unset: unset });
            console.log("🗑️ Cleared badge keys from Act:", dateISO);
          } catch (err) {
            console.error("❌ Failed to $unset badge keys:", err.message);
          }

          await sendWhatsAppText(
            toE164,
            "Thanks for letting us know — we've updated your availability."
          );

          // ✅ Only trigger deputy notifications if YES / NOLOC / NOLOCATION
        // ✅ Revised logic: always trigger deputies when LEAD replies unavailable
const shouldTriggerDeputies =
  (!isDeputy && ["unavailable", "no", "noloc", "nolocation"].includes(reply));

if (act?._id && shouldTriggerDeputies) {
  console.log(
    `📢 Triggering deputy notifications for ${act?.tscName || act?.name} — ${dateISO}`
  );

await notifyDeputies({
  actId: act._id,
  lineupId: updated.lineupId || act.lineups?.[0]?._id || null,
  dateISO,
  formattedAddress:
    updated.formattedAddress || act.formattedAddress || "TBC",
  clientName: updated.clientName || "",
  clientEmail: updated.clientEmail || "",
  slotIndex, // 👈 use the explicitly extracted one for clarity
  skipDuplicateCheck: true,
  skipIfUnavailable: false,
});
console.log("📤 notifyDeputies triggered with slotIndex:", slotIndex);
} else if (isDeputy && reply === "unavailable") {
  console.log("📨 Deputy unavailable — trigger next deputy in queue");

  const { triggerNextDeputy } = await import("./notifyDeputiesHelpers.js");
  await triggerNextDeputy({
    actId: act._id,
    lineupId: updated.lineupId || act.lineups?.[0]?._id || null,
    dateISO,
    excludePhones: [
      updated.phone,
      updated.whatsappNumber,
      ...await AvailabilityModel.distinct("phone", {
        actId,
        dateISO,
        reply: { $in: ["unavailable", "yes"] },
      }),
    ],
  });
}

          // 📨 Cancellation email
          try {
            const { sendEmail } = await import("../utils/sendEmail.js");
            const subject = `❌ ${
              act?.tscName || act?.name
            }: Diary Invite Cancelled for ${new Date(
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
            const recipients = [leadEmail].filter(
              (e) => e && e.includes("@")
            );

            if (recipients.length > 0) {
              console.log(
                "📧 Preparing to send cancellation email:",
                recipients
              );
              await sendEmail({
                to: recipients,
                bcc: ["hello@thesupremecollective.co.uk"],
                subject,
                html,
              });
              console.log(
                `✅ Cancellation email sent successfully to: ${recipients.join(
                  ", "
                )}`
              );
            } else {
              console.warn(
                "⚠️ Skipping cancellation email — no valid recipients found."
              );
            }
          } catch (emailErr) {
            console.error(
              "❌ Failed to send cancellation email:",
              emailErr.message
            );
          }

          // 🔔 SSE clear badge
          if (!updated.isDeputy && global.availabilityNotify?.badgeUpdated) {
            const stillActive = await AvailabilityModel.exists({
              actId,
              dateISO,
              reply: "yes",
            });

            
          }
          // 🚫 Ensure lead badge stays cleared even if deputies respond later
const update = {
  $unset: {
    [`availabilityBadges.${dateISO}`]: "",
    [`availabilityBadges.${dateISO}_tbc`]: "",
  },
};

// 🔒 Only set lock when reply is truly unavailable
if (!isDeputy && ["unavailable", "no", "noloc", "nolocation"].includes(reply)) {
  update.$set = {
    [`availabilityBadgesMeta.${dateISO}.lockedByLeadUnavailable`]: true,
  };
}

await Act.updateOne({ _id: actId }, update);
console.log("🔒 Lead marked UNAVAILABLE — badge locked for date:", dateISO);

          return;
        } // ← closes unavailable branch

      } catch (err) {
        console.error("❌ Error in twilioInbound background task:", err);
      }
    })(); // ✅ closes async IIFE
  }); // ✅ closes setImmediate
}; // ✅ closes twilioInbound

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


export const makeAvailabilityBroadcaster = (broadcastFn) => ({
  leadYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({
      type: "availability_yes",
      actId,
      actName,
      musicianName: musicianName || "Lead Vocalist",
      dateISO,
    });
  },

deputyYes: ({ actId, actName, musicianName, dateISO, badge }) => {
  const deputyName = (musicianName || badge?.deputies?.[0]?.vocalistName || badge?.deputies?.[0]?.name || "Deputy Vocalist");
  

    broadcastFn({
      type: "availability_deputy_yes",
      actId,
      actName,
      musicianName: deputyName,
      dateISO,
    });
  },

badgeUpdated: ({ actId, actName, dateISO, badge }) => {
  if (!badge) {
    console.log("🔕 SSE: badge was null/undefined – skipping broadcast", { actId, dateISO });
    return; // ✅ STOP here, do NOT send to SSE
  }

  // If badge exists, broadcast it as normal
  broadcastFn({
    type: "availability_badge_updated",
    actId,
    actName,
    dateISO,
    badge,
  });
}
});

// one-shot WA→SMS for a single deputy
export async function handleLeadNegativeReply({ act, updated, fromRaw = "" }) {
  console.log(`🟢 (availabilityController.js) handleLeadNegativeReply START`);
  // 1) Find the lead in the lineup by phone (so we can access their deputies)
  const leadMatch = findPersonByPhone(
    act,
    updated.lineupId,
    updated.phone || fromRaw
  );
  const leadMember = leadMatch?.parentMember || leadMatch?.person || null;
  const deputies = Array.isArray(leadMember?.deputies)
    ? leadMember.deputies
    : [];

  console.log(
    "👥 Deputies for lead:",
    deputies.map((d) => ({
      name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
      phone: d.phoneNumber || d.phone || "",
    }))
  );

  // 2) Build normalized phone list for deputies
  const norm = (v) =>
    String(v || "")
      .replace(/^whatsapp:/i, "")
      .replace(/\s+/g, "")
      .replace(/^0(?=7)/, "+44")
      .replace(/^(?=44)/, "+");

  const depPhones = deputies
    .map((d) => ({ obj: d, phone: norm(d.phoneNumber || d.phone || "") }))
    .filter((x) => !!x.phone);

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
  const repliedNo = new Map(); // phone -> row
  const pending = new Map(); // phone -> most-recent row (no reply yet)

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
      if (
        !prev ||
        ts > new Date(prev.updatedAt || prev.createdAt || 0).getTime()
      ) {
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
      try {
        console.log("📤 Sending WhatsApp to deputy…");
        console.log("🟦 About to sendWhatsAppMessage using content SID:", process.env.TWILIO_ENQUIRY_SID);
        const sendRes = await sendWhatsAppMessage({
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
        });
        await AvailabilityModel.updateOne(
          { _id: row?._id },
          {
            $set: {
              status: sendRes?.status || "queued",
              messageSidOut: sendRes?.sid || row?.messageSidOut || null,
              contactChannel:
                sendRes?.channel || row?.contactChannel || "whatsapp",
              updatedAt: new Date(),
            },
          }
        );
        rePingCount++;
        console.log("✅ Deputy pinged");
      } catch (e) {
        console.warn("⚠️ Failed to notify deputy", e?.message || e);
      }
    }
  }

  // 6) Top up with fresh deputies to reach 3 active
  let freshPinged = 0;

  if (toFill > 0) {
    const alreadyActive = new Set([
      ...activeYes.map(({ phone }) => phone),
      ...activePending.map(({ phone }) => phone),
    ]);

    const candidates = depPhones.filter(
      ({ phone }) => !repliedNo.has(phone) && !alreadyActive.has(phone)
    );

    for (const cand of candidates.slice(0, toFill)) {
      try {
        const { phone: depPhone, enquiryId: depEnquiryId } =
         await notifyDeputies({
  act,
  lineupId: updated.lineupId,
  dateISO: updated.dateISO,
  excludePhone: toE164,
});
        console.log("✅ Deputy pinged");
        freshPinged++;
      } catch (e) {
        console.warn("⚠️ Failed to notify deputy", e?.message || e);
      }
    }
  }

  console.log(
    `✅ Deputies active after lead NO/UNAVAILABLE: yes=${activeYes.length}, pending=${activePending.length}, rePinged=${rePingCount}, newlyPinged=${freshPinged}`
  );

  return {
    activeYes: activeYes.length,
    activePending: activePending.length,
    rePinged: rePingCount,
    newlyPinged: freshPinged,
  };
}


export async function pingDeputiesFor(
  actId,
  lineupId,
  dateISO,
  formattedAddress,
  duties
) {
  console.log(`🟢 (availabilityController.js) pingDeputiesFor START`);
  const act = await Act.findById(actId).lean();
  if (!act) return;
  const fakeUpdated = {
    actId,
    lineupId,
    phone: "",
    dateISO,
    formattedDate: formatWithOrdinal(dateISO),
    formattedAddress: formattedAddress || "",
    duties: duties || "your role",
    fee: "",
  };
  await handleLeadNegativeReply({ act, updated: fakeUpdated });
}

// --- Availability Badge Rebuild Helpers (WhatsApp-only flow) ---

// ✅ buildAvailabilityBadgeFromRows (refined to include both photoUrl & profileUrl)
// controllers/availabilityBadgeController.js (or wherever it lives)
export async function buildAvailabilityBadgeFromRows({ actId, dateISO, hasLineups = true }) {
  console.log("🟣 buildAvailabilityBadgeFromRows START", { actId, dateISO, hasLineups });

  const rows = await AvailabilityModel.find({
    actId,
    dateISO,
    reply: { $in: ["yes", "no", "unavailable", null] },
    v2: true,
  })
    // NOTE: added phone, musicianEmail, repliedAt to support lookups + UI timestamps
    .select("musicianId slotIndex reply updatedAt repliedAt isDeputy photoUrl phone musicianEmail")
    .lean();

  console.log("📥 buildBadge: availability rows:", rows);
  if (!rows.length) return null;

  const groupedBySlot = rows.reduce((acc, row) => {
    const key = String(row.slotIndex ?? 0);
    (acc[key] ||= []).push(row);
    return acc;
  }, {});
  console.log("📦 buildBadge: rows grouped by slot:", Object.keys(groupedBySlot));

  const isHttp = (u) => typeof u === "string" && u.startsWith("http");

  const slots = [];
  const orderedKeys = Object.keys(groupedBySlot).sort((a, b) => Number(a) - Number(b));

  for (const slotKey of orderedKeys) {
    const slotRows = groupedBySlot[slotKey];
    console.log(`🟨 SLOT ${slotKey} — raw rows:`, slotRows);

    // Split lead vs deputy
    const leadRows   = slotRows.filter(r => r.isDeputy !== true);
    const deputyRows = slotRows.filter(r => r.isDeputy === true);

    // Latest meaningful lead reply
    const leadReply = leadRows
      .filter(r => ["yes", "no", "unavailable"].includes(r.reply))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;

    // Resolve lead display bits
    let leadDisplayBits = null;
    if (leadReply?.musicianId) {
      try {
        leadDisplayBits = await getDeputyDisplayBits({ musicianId: leadReply.musicianId });
      } catch (e) {
        console.warn("getDeputyDisplayBits (lead) failed:", e?.message);
      }
    }

    // Normalized lead object (used for primary decision)
    const leadBits = leadDisplayBits
      ? {
          musicianId: String(leadDisplayBits.musicianId || leadReply?.musicianId || ""),
          photoUrl: leadDisplayBits.photoUrl || null,
          profileUrl: leadDisplayBits.profileUrl || "",
          setAt: leadReply?.updatedAt || null,
          state: leadReply?.reply || "pending",
          available: leadReply?.reply === "yes",
          isDeputy: false,
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

    // Deputies — include ALL (even pending) so fallback-to-photo works
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
          vocalistName: bits?.resolvedName || bits?.firstName || "",
          state: r.reply ?? null,
          available: r.reply === "yes",
          setAt: r.updatedAt || null,
          repliedAt: r.repliedAt || r.updatedAt || null,
        });
      } catch (e) {
        console.warn("getDeputyDisplayBits (deputy) failed:", e?.message, r?.musicianId);
      }
    }

    // Choose primary
    const leadAvailable = leadBits?.available === true;
    const coveringYes = deputies.find(d => d.available && isHttp(d.photoUrl));
    const firstDepWithPhoto = deputies.find(d => isHttp(d.photoUrl));

    let primary = null;
    if (!leadAvailable && coveringYes) {
      primary = coveringYes;                                 // ✅ deputy covers if lead unavailable
    } else if (leadAvailable && isHttp(leadBits?.photoUrl)) {
      primary = leadBits;                                    // ✅ lead is available with photo
    } else if (!leadAvailable && firstDepWithPhoto) {
      primary = firstDepWithPhoto;                           // fallback to any deputy with photo
    } else if (isHttp(leadBits?.photoUrl)) {
      primary = leadBits;                                    // last resort: show lead photo
    }

    const mus = leadReply?.musicianId
      ? await Musician.findById(leadReply.musicianId)
          .select("firstName lastName profilePhoto photoUrl")
          .lean()
      : null;

    const name = (
      leadReply?.selectedVocalistName ||
      leadReply?.vocalistName ||
      leadReply?.musicianName ||
      `${mus?.firstName || ""} ${mus?.lastName || ""}`.trim()
    ).trim();


    // Final slot (keep legacy top-level fields for compatibility)
    slots.push({
      slotIndex: Number(slotKey),
      isDeputy: false, // legacy
      vocalistName: name, 
      musicianId: leadBits?.musicianId ?? (leadReply ? String(leadReply.musicianId) : null),
      photoUrl: leadBits?.photoUrl || null,
      profileUrl: leadBits?.profileUrl || "",
      deputies,
      setAt: leadReply?.updatedAt || null,
      state: leadReply?.reply || "pending",

      // ✅ New unified flags used by UI
      available: Boolean(leadAvailable || coveringYes),                  // slot can be covered on this date
      covering: primary?.isDeputy ? "deputy" : "lead",                   // who is shown as primary

      // ✅ The one thing the UI should render
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
    });
  }

  const badge = { dateISO, address: "TBC", active: true, slots };
  console.log("💜 FINAL BADGE:", badge);
  return badge;
}


export async function rebuildAndApplyAvailabilityBadge({ actId, dateISO }) {
  console.log("🟦 rebuildAndApplyAvailabilityBadge START", { actId, dateISO });

  if (!actId || !dateISO) {
    console.error("❌ rebuildAndApplyAvailabilityBadge missing actId/dateISO", {
      actId,
      dateISO
    });
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 🟦 2. FETCH ACT + LOG SUMMARY                                       */
  /* ------------------------------------------------------------------ */
  const actDoc = await Act.findById(actId)
    .select("+availabilityBadgesMeta")
    .lean();

  console.log("📘 actDoc fetched:", {
    name: actDoc?.tscName || actDoc?.name,
    hasLineups: Array.isArray(actDoc?.lineups),
    hasMeta: !!actDoc?.availabilityBadgesMeta?.[dateISO]
  });

  if (!actDoc) return { success: false, message: "Act not found" };

  /* ------------------------------------------------------------------ */
  /* 🟦 3. BUILD RAW BADGE + LOG RESULT                                  */
  /* ------------------------------------------------------------------ */
  let badge = await buildAvailabilityBadgeFromRows({
    actId,
    dateISO,
    hasLineups: actDoc?.hasLineups ?? true,
  });

  console.log("🎨 Raw badge returned from buildAvailabilityBadgeFromRows:", badge);

  /* ------------------------------------------------------------------ */
  /* 🟦 4. FETCH ALL AVAILABILITY ROWS + LOG                             */
  /* ------------------------------------------------------------------ */
  const availRows = await AvailabilityModel.find({ actId, dateISO }).lean();

  console.log("📥 Availability rows at rebuild:", availRows.map(r => ({
    id: r._id,
    musicianId: r.musicianId,
    reply: r.reply,
    slotIndex: r.slotIndex,
    updatedAt: r.updatedAt
  })));

  /* ------------------------------------------------------------------ */
  /* 🟡 If no badge, attempt to clear + broadcast null                   */
  /* ------------------------------------------------------------------ */
  if (!badge) {
    console.log("🟠 No badge returned — attempting CLEAR operation");

    const stillActive = await AvailabilityModel.exists({
      actId,
      dateISO,
      reply: "yes",
    });

    if (stillActive) {
      console.log("🟡 CLEAR skipped — active YES rows still present");
      return { success: true, skipped: true };
    }

    await Act.updateOne(
      { _id: actId },
      { $unset: { [`availabilityBadges.${dateISO}`]: "" } }
    );

    console.log("🧹 CLEAR applied:", {
      actId,
      dateISO,
      reason: "badge null",
      stillActive
    });

    return { success: true, cleared: true }; // ← this must be INSIDE the if-block
  }

  /* ------------------------------------------------------------------ */
  /* 🟦 5. BEFORE SAVING                                                 */
  /* ------------------------------------------------------------------ */
  const shortAddress = (badge?.address || actDoc?.formattedAddress || "unknown")
    .replace(/\b(united_kingdom|uk)\b/gi, "")
    .replace(/\W+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();

  const key = `${dateISO}_${shortAddress}`;

  console.log("💾 FINAL badge about to apply:", {
    key,
    actId,
    dateISO,
    slots: badge?.slots,
    photoUrl: badge?.photoUrl,
    profileUrl: badge?.profileUrl
  });

  /* ------------------------------------------------------------------ */
  /* 🟩 SAVE BADGE TO ACT                                                */
  /* ------------------------------------------------------------------ */
  await Act.updateOne(
    { _id: actId },
    { $set: { [`availabilityBadges.${key}`]: badge } }
  );

  console.log(`✅ Applied badge for ${actDoc.tscName || actDoc.name}`);

  /* ------------------------------------------------------------------ */
  /* 🟦 6. SSE BROADCAST                                                 */
  /* ------------------------------------------------------------------ */
  if (global.availabilityNotify?.badgeUpdated) {
    console.log("📡 SSE badgeUpdated fired:", {
      actId,
      dateISO,
      slots: badge?.slots?.length,
      badgeIsNull: false
    });

    global.availabilityNotify.badgeUpdated({
      type: "availability_badge_updated",
      actId: String(actId),
      actName: actDoc?.tscName || actDoc?.name,
      dateISO,
      badge
    });
  }

  return { success: true, updated: true, badge }; // ← now back inside function
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
