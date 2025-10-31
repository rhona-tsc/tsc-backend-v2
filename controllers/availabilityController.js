import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { cancelCalendarInvite, createCalendarInvite } from "../controllers/googleController.js";
import { sendSMSMessage, sendWhatsAppText } from "../utils/twilioClient.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { postcodes } from "../utils/postcodes.js"; // <-- ensure this path is correct in backend
import { countyFromOutcode } from "../controllers/helpersForCorrectFee.js";
import Shortlist from "../models/shortlistModel.js";
import sendEmail from "../utils/sendEmail.js";
import User from "../models/userModel.js";
import mongoose from "mongoose";
import { calculateActPricing } from "./helpers.js";

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

export async function sendAvailabilityRequest({
  musician,
  act,
  lineupId,
  dateISO,
  formattedDate,
  formattedAddress,
  fee,
  duties,
}) {
  console.log("📤 sendAvailabilityRequest START", { to: musician?.phone });

  const phone = musician?.phone || musician?.phoneNumber;
  if (!phone) throw new Error("Missing phone for musician");

  const toE164 = (v = "") =>
    v.startsWith("+") ? v : v.replace(/^0/, "+44").replace(/^44/, "+44");
  const phoneNorm = toE164(phone);

  // 🗓️ Nicely formatted date
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
  const formattedDateNice = `${weekday}, ${day}${suffix} ${month} ${year}`;

  // 📍 Location short form
  const addressShort =
    formattedAddress?.match(/([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/)?.[0] ||
    formattedAddress ||
    "TBC";

  // 💷 Format fee
  const numericFee = Number(fee);
  const feeDisplay =
    Number.isFinite(numericFee) && numericFee > 0
      ? `£${Math.round(numericFee)}`
      : "TBC";

  // 🎤 Duties
  const dutiesClean =
    duties?.replace(/\bVocal\b/, "Female Vocal") ||
    duties ||
    "performance";

  const actName = act?.tscName || act?.name || "the band";
  const contentSid = process.env.TWILIO_ENQUIRY_SID;
  const musicianName = `${musician.firstName || ""} ${musician.lastName || ""}`.trim();

  // ✅ Ensure the fallback SMS body matches the enriched vars
  const safeMusicianName = musicianName || "there";
  const safeFee = feeDisplay || "TBC";
  const safeRole = dutiesClean || "your role";
  const safeDate = formattedDateNice;
  const safeLocation = formattedAddress || addressShort || "TBC";
  const safeAct = actName || "the band";

  const smsBody = `Hi ${safeMusicianName}, you've received an enquiry for a gig on ${safeDate} in ${safeLocation} at a rate of ${safeFee} for ${safeRole} duties with ${safeAct}. Please indicate your availability 💫`;

  return await sendWhatsAppMessage({
    to: `whatsapp:${phoneNorm}`,
    contentSid,
    variables: {
      musicianName: safeMusicianName,
      date: safeDate,
      location: safeLocation,
      fee: safeFee,
      role: safeRole,
      actName: safeAct,
    },
    smsBody,
  });
}
/**
 * Send a client-facing email about act availability.
 * Falls back to hello@thesupremecollective.co.uk if no client email found.
 */
export async function sendClientEmail({ actId, subject, html }) {
  try {
    const act = await Act.findById(actId).lean();
    const recipient =
      act?.contactEmail ||
      process.env.NOTIFY_EMAIL ||
      "hello@thesupremecollective.co.uk";

    console.log(`📧 Sending client availability email to ${recipient}...`);
    await sendEmail(
      [recipient, "hello@thesupremecollective.co.uk"],
      subject,
      html
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
  console.log(
    `🟢 (availabilityController.js) normalizeToE164 START at ${new Date().toISOString()}`,
    {}
  );
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

export async function notifyDeputies({ act, lineupId, dateISO, excludePhone, address }) {
  console.log("📢 [notifyDeputies] START", {
    actName: act?.tscName || act?.name,
    lineupId,
    dateISO,
    excludePhone,
    address,
  });

  // ✅ Always have a lineup: use provided one or smallest/first
  let lineup = act?.lineups?.find((l) => String(l._id) === String(lineupId));
  if (!lineup && Array.isArray(act?.lineups) && act.lineups.length > 0) {
    lineup = act.lineups.reduce((smallest, curr) => {
      const currSize = curr.bandMembers?.filter((m) => m.isEssential).length || 0;
      const smallSize = smallest.bandMembers?.filter((m) => m.isEssential).length || 0;
      return currSize < smallSize ? curr : smallest;
    }, act.lineups[0]);
    console.log("🧭 [notifyDeputies] No lineupId provided — defaulting to smallest lineup:", {
      selectedLineupId: lineup?._id,
      actSize: lineup?.actSize,
    });
  }

  if (!lineup) {
    console.warn(`⚠️ [notifyDeputies] No lineups exist for ${act?.tscName || act?.name}`);
    return;
  }

  const vocalists =
    lineup.bandMembers?.filter((m) =>
      ["lead vocal", "lead female vocal", "male vocal", "vocalist-guitarist"].some((v) =>
        (m.instrument || "").toLowerCase().includes(v)
      )
    ) || [];

  console.log("🎤 [notifyDeputies] Vocalists found:", vocalists.map((v) => v.firstName || v.name));

  const validDeputies = [];
  for (const vocalist of vocalists) {
    for (const dep of vocalist.deputies || []) {
      const rawPhone = dep.phoneNumber || dep.phone;
      if (!rawPhone) continue;
      const cleaned = rawPhone.replace(/\s+/g, "");
      if (/^\+?\d{10,15}$/.test(cleaned) && cleaned !== excludePhone) {
        const finalFee = await computeFinalFeeForMember(
          act,
          dep,
          address || act.venueAddress,
          dateISO,
          lineup
        );
        validDeputies.push({ ...dep, phone: cleaned, finalFee });
      }
    }
  }

  console.log("👥 [notifyDeputies] Valid deputies:", validDeputies.map((d) => ({
    name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
    phone: d.phone,
    finalFee: d.finalFee,
  })));

  if (validDeputies.length === 0) {
    console.log("ℹ️ [notifyDeputies] No deputies with valid phone numbers");
    return;
  }

  const formattedDate = new Date(dateISO).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  for (const deputy of validDeputies) {
    await notifyDeputyOneShot({
      act,
      lineupId: lineup._id,
      deputy,
      dateISO,
      formattedDate,
      formattedAddress: address || act?.venueAddress || "TBC",
      duties: "Lead Female Vocal",
      finalFee: deputy.finalFee,
      metaActId: act._id,
    });
  }

  console.log("✅ [notifyDeputies] Finished sending all deputy notifications");
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
    {}
  );
  const destination =
    typeof selectedAddress === "string"
      ? selectedAddress
      : selectedAddress?.postcode || selectedAddress?.address || "";

  const origin = member?.postCode;
  if (!destination || !origin) return 0;

  // Branch 1) County fee per member
  if (act.useCountyTravelFee && act.countyFees) {
    const key = String(selectedCounty || "").toLowerCase();
    const feePerMember =
      Number(act.countyFees?.[key] ?? act.countyFees?.get?.(key) ?? 0) || 0;
    return feePerMember; // already per-member
  }

  // Branch 2) Cost-per-mile
  if (Number(act.costPerMile) > 0) {
    const data = await fetchTravel(origin, destination, selectedDate);
    const distanceMeters = data?.outbound?.distance?.value || 0;
    const distanceMiles = distanceMeters / 1609.34;
    return distanceMiles * Number(act.costPerMile) * 25; // your existing multiplier
  }

  // Branch 3) MU-style calc
  const data = await fetchTravel(origin, destination, selectedDate);
  const outbound = data?.outbound;
  const returnTrip = data?.returnTrip;
  if (!outbound || !returnTrip) return 0;

  const totalDistanceMiles =
    (outbound.distance.value + returnTrip.distance.value) / 1609.34;
  const totalDurationHours =
    (outbound.duration.value + returnTrip.duration.value) / 3600;

  const fuelFee = totalDistanceMiles * 0.56;
  const timeFee = totalDurationHours * 13.23;
  const lateFee = returnTrip.duration.value / 3600 > 1 ? 136 : 0;
  const tollFee = (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);

  return fuelFee + timeFee + lateFee + tollFee; // per member
};

function findVocalistPhone(actData, lineupId) {
  console.log(
    `🐠 (controllers/shortlistController.js) findVocalistPhone called at`,
    new Date().toISOString(),
    {
      lineupId,
      totalLineups: actData?.lineups?.length || 0,
    }
  );
  if (!actData?.lineups?.length) return null;

  // Prefer specified lineupId
  const lineup = lineupId
    ? actData.lineups.find(
        (l) => String(l._id || l.lineupId) === String(lineupId)
      )
    : actData.lineups[0];

  if (!lineup?.bandMembers?.length) return null;

  // Find first member with instrument containing "vocal"
  const vocalist = lineup.bandMembers.find((m) =>
    String(m.instrument || "")
      .toLowerCase()
      .includes("vocal")
  );

  if (!vocalist) return null;

  // Safely pick phone fields
  let phone = vocalist.phoneNormalized || vocalist.phoneNumber || "";
  if (!phone && Array.isArray(vocalist.deputies) && vocalist.deputies.length) {
    phone =
      vocalist.deputies[0].phoneNormalized ||
      vocalist.deputies[0].phoneNumber ||
      "";
  }

  // Normalise to E.164 if needed
  phone = toE164(phone);

  if (!phone) {
    console.warn("⚠️ No valid phone found for vocalist:", {
      vocalist: `${vocalist.firstName} ${vocalist.lastName}`,
      lineup: lineup.actSize,
      act: actData.tscName || actData.name,
    });
    return null;
  }

  console.log("🎤 Lead vocalist found:", {
    name: `${vocalist.firstName} ${vocalist.lastName}`,
    instrument: vocalist.instrument,
    phone,
    email: vocalist.email,
  });

  return { vocalist, phone };
}

// handle status callback from Twilio

// ✅ main function

export const shortlistActAndTriggerAvailability = async (req, res) => {
  try {
    console.log(
      "🎯 (shortlistController.js) shortlistActAndTriggerAvailability START at",
      new Date().toISOString(),
      {
        body: req.body,
      }
    );

    const { actId, lineupId = null, date, address, userId } = req.body;

    // 🧩 Normalise input
    const effectiveDate = date;
    const effectiveAddress = address;
    console.log("📦 Normalised body:", {
      userId,
      actId,
      lineupId,
      effectiveDate,
      effectiveAddress,
    });

    // ✅ Create or update the user's shortlist entry
    const shortlist = await Shortlist.findOneAndUpdate(
      { userId },
      {
        $addToSet: {
          acts: {
            actId,
            dateISO: effectiveDate,
            formattedAddress: effectiveAddress,
          },
        },
      },
      { new: true, upsert: true }
    );

    console.log("📝 Shortlist updated:", {
      userId,
      actId,
      totalActs: shortlist.acts.length,
    });

    // ✅ Prepare mock req/res for triggerAvailabilityRequest
    const mockReq = {
      body: {
        actId,
        lineupId,
        date: effectiveDate,
        address: effectiveAddress,
      },
      query: {}, // prevents undefined references in triggerAvailabilityRequest
    };

    const mockRes = {
      status: (code) => ({
        json: (obj) => {
          console.log(`📬 Mock availability response [${code}]:`, obj);
          return obj;
        },
      }),
      json: (obj) => {
        console.log(`📬 Mock availability response:`, obj);
        return obj;
      },
    };

    console.log("📣 Delegating to triggerAvailabilityRequest...");
    await triggerAvailabilityRequest(mockReq, mockRes);

    console.log("✅ WhatsApp message sent successfully", {
      success: true,
      message: "Act shortlisted and availability triggered",
      shortlisted: true,
    });

    return res.json({
      success: true,
      message: "Act shortlisted and availability triggered",
      shortlisted: true,
    });
  } catch (err) {
    console.error("❌ shortlistActAndTriggerAvailability error:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
};

export const triggerAvailabilityRequest = async (req, res) => {
  console.log(
    `🟢 (availabilityController.js) triggerAvailabilityRequest START at ${new Date().toISOString()}`
  );
  try {
    console.log("🛎 triggerAvailabilityRequest body:", req.body);

    const { actId, lineupId, date, address } = req.body;
    if (!actId || !date || !address) {
      return res
        .status(400)
        .json({ success: false, message: "Missing actId/date/address" });
    }

    // 🧩 Guard: prevent duplicate trigger for same act/date/address
    const dateISO = new Date(date).toISOString().slice(0, 10);
    const shortAddress = (address || "")
      .split(",")
      .slice(-2)
      .join(",")
      .replace(/,\s*UK$/i, "")
      .trim();

    const existingEnquiry = await AvailabilityModel.findOne({
      actId,
      dateISO,
      formattedAddress: shortAddress,
    }).lean();

    if (existingEnquiry) {
      console.log(
        "⛔ Already triggered for act/date/address:",
        existingEnquiry.dateISO,
        existingEnquiry.formattedAddress
      );
      return res.json({
        success: true,
        skipped: true,
        message: "Duplicate prevented",
      });
    }

    // Continue if no duplicate found
    const act = await Act.findById(actId).lean();
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    const formattedDate = formatWithOrdinal(date);
    const { outcode, county: selectedCounty } = countyFromAddress(address);

    // lineup
    const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
    const lineup = lineupId
      ? lineups.find(
          (l) =>
            l._id?.toString?.() === String(lineupId) ||
            String(l.lineupId) === String(lineupId)
        )
      : lineups[0];

    const members = Array.isArray(lineup?.bandMembers)
      ? lineup.bandMembers
      : [];

    // phone normaliser
    const normalizePhone = (raw = "") => {
      let v = String(raw || "")
        .replace(/\s+/g, "")
        .replace(/^whatsapp:/i, "");
      if (!v) return "";
      if (v.startsWith("+")) return v;
      if (v.startsWith("07")) return v.replace(/^0/, "+44");
      if (v.startsWith("44")) return `+${v}`;
      return v;
    };

    // 1️⃣ Existing availability rows
    const prevRows = await AvailabilityModel.find({ actId, dateISO })
      .select({ phone: 1, reply: 1, updatedAt: 1, createdAt: 1 })
      .lean();

    const toE164 = (v) => normalizePhone(v);
    const repliedYes = new Map();
    const repliedNo = new Map();
    const pending = new Map();

    for (const r of prevRows) {
      const p = toE164(r.phone);
      if (!p) continue;
      const rep = String(r.reply || "").toLowerCase();
      if (rep === "yes") repliedYes.set(p, r);
      else if (rep === "no" || rep === "unavailable") repliedNo.set(p, r);
      else pending.set(p, r);
    }

    const negatives = new Set([...repliedNo.keys()]);
    const alreadyPingedSet = new Set([
      ...repliedYes.keys(),
      ...pending.keys(),
      ...negatives.keys(),
    ]);
    console.log("🚫 Known-unavailable:", [...negatives]);
    console.log("🔁 Already pinged:", [...alreadyPingedSet]);

    // 2️⃣ Lead vocalist lookup
    const found = findVocalistPhone(act, lineupId);
    if (!found?.vocalist || !found?.phone) {
      return res.json({
        success: true,
        message: "No vocalist with valid phone found",
      });
    }

    const lead = found.vocalist;
    const phone = found.phone;
    const phoneNorm = normalizePhone(phone);

    if (negatives.has(phoneNorm)) {
      console.log("⏭️ Lead already marked unavailable — skipping.");
      return res.json({
        success: true,
        skipped: true,
        reason: "lead_unavailable",
      });
    }

    if (!phoneNorm) {
      console.warn("⚠️ Lead has no usable phone, skipping.");
      return res.json({ success: false, message: "No phone for vocalist" });
    }

    // 3️⃣ Fee calculation
    const feeForMember = async (member) => {
      const baseFee = Number(member?.fee ?? 0);
      const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
      const membersCount = Math.max(
        1,
        (Array.isArray(members) ? members.length : 0) || 1
      );
      const perHead =
        lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
      const base = baseFee > 0 ? baseFee : perHead;
      const { county: selectedCounty } = countyFromAddress(address);
      const selectedDate = dateISO;

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
          selectedDate,
        });
        travelFee = Math.max(0, Math.ceil(Number(travelFee || 0)));
      }

      return Math.max(0, Math.ceil(Number(base || 0) + Number(travelFee || 0)));
    };

    const finalFee = await feeForMember(lead);

    // 4️⃣ Prevent duplicates within short window
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    const recentPending = await AvailabilityModel.findOne({
      actId,
      dateISO,
      phone: phoneNorm,
      reply: null,
      updatedAt: { $gte: new Date(Date.now() - THREE_HOURS) },
    }).lean();

    if (recentPending) {
      await DeferredAvailability.create({
        phone: phoneNorm,
        actId: act._id,
        dateISO,
        duties: lead.instrument || "Lead Vocal",
        fee: String(finalFee),
        formattedDate,
        formattedAddress: shortAddress,
        payload: { to: phoneNorm },
      });
      console.log("⏸️ Deferred enquiry due to active pending.");
      return res.json({ success: true, deferred: true });
    }

    // ✅ NEW: CREATE DB RECORD BEFORE SENDING MESSAGE
    const newAvailability = new AvailabilityModel({
      actId: act._id,
      lineupId: lineup?._id || null,
      musicianId: lead?._id || null,
      phone: phoneNorm,
      dateISO,
      formattedAddress: shortAddress,
      formattedDate,
      actName: act?.tscName || act?.name || "",
      musicianName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
      duties: lead.instrument || "Lead Vocal",
      fee: String(finalFee),
      reply: null,
      v2: true,
    });

    await newAvailability.save();
    console.log("✅ Created AvailabilityModel record:", {
      id: newAvailability._id,
      phone: phoneNorm,
      dateISO,
      act: act?.tscName || act?.name,
      fee: finalFee,
    });

    // 5️⃣ Send WhatsApp (shared helper)
try {
  const sendRes = await sendWhatsAppMessage({
    musician: lead,
    act,
    lineupId: lineup?._id,
    dateISO,
    formattedDate,
    formattedAddress: shortAddress,
    fee: finalFee,
    duties: lead.instrument || "Lead Vocal",
  });
  console.log("✅ WhatsApp sent successfully:", sendRes);
  return res.json({ success: true, sent: 1 });
} catch (err) {
  console.warn("⚠️ WhatsApp send failed:", err.message);
  return res.json({ success: false, message: err.message });
}
  } catch (err) {
    console.error("❌ triggerAvailabilityRequest error:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
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

export async function notifyDeputyOneShot({
  act,
  lineupId,
  deputy,
  dateISO,
  formattedDate,
  formattedAddress,
  duties,
  finalFee,
  metaActId,
}) {
  console.log("📤 notifyDeputyOneShot() START", {
    deputyName: `${deputy.firstName || ""} ${deputy.lastName || ""}`.trim(),
    phone: deputy.phone,
    finalFee,
    formattedAddress,
    act: act?.tscName || act?.name,
  });

  try {
    // 🧮 Clean + format fee nicely
    const numericFee = typeof finalFee === "number"
      ? finalFee
      : parseFloat(String(finalFee).replace(/[^\d.]/g, "")) || 0;

    const formattedFee = numericFee > 0 ? `£${numericFee}` : "TBC";

    // 📍 Clean address
    const location = formattedAddress && formattedAddress.trim() !== ""
      ? formattedAddress.split(",").slice(0, 2).join(", ")
      : act?.venueAddress?.split(",").slice(0, 2).join(", ") || "TBC";

    // 🧠 Build template parameters
    const templateParams = {
      actName: act?.tscName || act?.name || "The Supreme Collective",
      date: formattedDate || "TBC",
      location,
      fee: formattedFee,
      role: duties || "Lead Vocal",
    };

    // 📨 Build message text (for SMS fallback or logging)
    const smsBody = `Hi ${deputy.firstName || deputy.name || "there"}, you've received an enquiry for a gig on ${templateParams.date} in ${templateParams.location} at a rate of ${templateParams.fee} for ${templateParams.role} duties with ${templateParams.actName}. Please indicate your availability 💫`;

    console.log("💬 [notifyDeputyOneShot] smsBody built:", smsBody);

    // ✅ Send via Twilio template
    await sendWhatsAppMessage({
      to: deputy.phone,
      actData: act,
      lineup: lineupId,
      member: deputy,
      address: location,
      dateISO,
      role: duties,
      templateParams,
contentSid: process.env.TWILIO_ENQUIRY_SID,
      smsBody,
    });

    console.log(`✅ notifyDeputyOneShot sent successfully to ${deputy.phone}`);
  } catch (err) {
    console.error("❌ notifyDeputyOneShot() failed:", err.message);
  }
}

export const twilioInbound = async (req, res) => {
  console.log(`🟢 [twilioInbound] START at ${new Date().toISOString()}`);

  // ✅ Immediately acknowledge Twilio to prevent retries
  res.status(200).send("OK");

  process.nextTick(async () => {
    try {
      console.log("📬 Raw inbound req.body:", req.body);

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

const act =
  updated?.actId && typeof updated.actId === "string"
    ? await Act.findById(new mongoose.Types.ObjectId(updated.actId)).lean()
    : updated?.actId
    ? await Act.findById(updated.actId).lean()
    : null;
    
    let musician = updated?.musicianId
        ? await Musician.findById(updated.musicianId).lean()
        : null;

      if (!musician && updated?.phone) {
        musician = await Musician.findOne({
          $or: [
            { phone: updated.phone },
            { whatsappNumber: updated.phone },
            { "contact.phone": updated.phone },
          ],
        }).lean();
      }

      const isDeputy = Boolean(updated.isDeputy || musician?.isDeputy);
      const emailForInvite = musician?.email || updated.calendarInviteEmail || null;
      const actId = String(updated.actId);
      const dateISO = updated.dateISO;
      const toE164 = normalizeToE164(updated.phone || fromRaw);

      /* ---------------------------------------------------------------------- */
      /* ✅ YES BRANCH (Lead or Deputy)                                         */
      /* ---------------------------------------------------------------------- */
      if (reply === "yes") {
        console.log(`✅ YES reply received via WhatsApp (${isDeputy ? "Deputy" : "Lead"})`);

        // 1️⃣ Create a calendar invite for either lead or deputy
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

        await sendWhatsAppText(toE164, "Super — we’ve sent a diary invite with full details.");

        // 2️⃣ Mark as available + rebuild badge
        updated.status = "read";
        if (isDeputy) updated.isDeputy = true;
        await updated.save();

        const badgeResult = await rebuildAndApplyAvailabilityBadge(
          { body: { actId, dateISO } },
          {
            json: () => {},
            status: () => ({ json: () => {} }),
          }
        );

        // 3️⃣ Broadcast SSE updates
        if (global.availabilityNotify) {
          // 🎯 Deputy availability toast
          if (isDeputy) {
            global.availabilityNotify.badgeUpdated({
              type: "deputy_yes",
              actId,
              actName: act?.tscName || act?.name,
              musicianName: musician?.firstName || updated.musicianName || "Deputy",
              dateISO,
              isDeputy: true,
            });
            console.log("📡 SSE broadcasted: deputy_yes");
          }

          // 🎤 Live badge refresh (lead or deputy)
          if (badgeResult?.badge) {
            global.availabilityNotify.badgeUpdated({
              type: "availability_badge_updated",
              actId,
              actName: act?.tscName || act?.name,
              dateISO,
              badge: badgeResult.badge,
              isDeputy,
            });
            console.log("📡 SSE broadcasted: availability_badge_updated");
          }
        }

        return;
      }

      /* ---------------------------------------------------------------------- */
      /* 🚫 NO / UNAVAILABLE / NOLOC BRANCH                                     */
      /* ---------------------------------------------------------------------- */
      if (["no", "unavailable", "noloc", "nolocation"].includes(reply)) {
        console.log("🚫 UNAVAILABLE reply received via WhatsApp");

        await AvailabilityModel.updateOne(
          { _id: updated._id },
          {
            $set: {
              status: "unavailable",
              reply: "unavailable",
              repliedAt: new Date(),
              calendarStatus: "cancelled",
            },
          }
        );

        if (updated?.calendarEventId && emailForInvite) {
          try {
            await cancelCalendarInvite(emailForInvite, updated.calendarEventId, updated.dateISO);
            console.log("✅ Calendar invite cancelled successfully");
          } catch (cancelErr) {
            console.error("❌ Failed to cancel calendar invite:", cancelErr.message);
          }
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

        await sendWhatsAppText(toE164, "Thanks for letting us know — we've updated your availability.");

        if (act?._id && updated?.lineupId) {
          await notifyDeputies({
            act,
            lineupId: updated.lineupId,
            dateISO,
            excludePhone: toE164,
          });
        }

  // 🔔 SSE clear badge (only if not deputy)
if (!updated.isDeputy && global.availabilityNotify?.badgeUpdated) {
  global.availabilityNotify.badgeUpdated({
    type: "availability_badge_updated",
    actId,
    actName: act?.tscName || act?.name,
    dateISO,
    badge: null,
  });
}

        return;
      }
    } catch (err) {
      console.error("❌ Error in twilioInbound background task:", err);
    }
  });
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
async function getDeputyDisplayBits(dep) {
  console.log(
    `🟢 (availabilityController.js) getDeputyDisplayBits START at ${new Date().toISOString()}`,
    {
      depKeys: Object.keys(dep || {}),
      depMusicianId: dep?.musicianId,
      depEmail: dep?.email,
      depName: `${dep?.firstName || ""} ${dep?.lastName || ""}`.trim(),
    }
  );

  const PUBLIC_SITE_BASE = (
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5174"
  ).replace(/\/$/, "");

  try {
    const musicianId =
      (dep?.musicianId && String(dep.musicianId)) ||
      (dep?._id && String(dep._id)) ||
      "";

    // 🎯 Step 1: try direct image on deputy
    let photoUrl = getPictureUrlFrom(dep);
    console.log("📸 Step 1: Direct deputy photoUrl →", photoUrl || "❌ none");

    // Step 2: lookup musician by ID if missing
    let mus = null;
    if ((!photoUrl || !photoUrl.startsWith("http")) && musicianId) {
      mus = await Musician.findById(musicianId)
        .select(
          "musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl email"
        )
        .lean();
      photoUrl = getPictureUrlFrom(mus || {});
      console.log("📸 Step 2: Lookup by musicianId →", photoUrl || "❌ none");
    }

    // Step 3: lookup by email if still missing
    if (
      (!photoUrl || !photoUrl.startsWith("http")) &&
      (dep?.email || mus?.email)
    ) {
      const email = dep?.email || dep?.emailAddress || mus?.email || "";
      console.log("📧 Step 3: Lookup by email →", email || "❌ none");
      if (email) {
        const musByEmail = await Musician.findOne({ email })
          .select(
            "musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl _id email"
          )
          .lean();
        if (musByEmail) {
          photoUrl = getPictureUrlFrom(musByEmail);
          console.log(
            "📸 Step 3 result: Found via email →",
            photoUrl || "❌ none"
          );
          if (!musicianId && musByEmail._id) {
            dep.musicianId = musByEmail._id;
          }
        } else {
          console.warn("⚠️ Step 3: No musician found for email", email);
        }
      }
    }

    const resolvedMusicianId =
      (dep?.musicianId && String(dep.musicianId)) || musicianId || "";
    const profileUrl = resolvedMusicianId
      ? `${PUBLIC_SITE_BASE}/musician/${resolvedMusicianId}`
      : "";
    const DEFAULT_PROFILE_PICTURE =
      "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1761313694/profile_placeholder_rcdly4.png";

    // 🪄 Step 4: fallback if no valid image found
    if (!photoUrl || !photoUrl.startsWith("http")) {
      photoUrl = DEFAULT_PROFILE_PICTURE;
      console.log("🪄 No valid photo found – using fallback image:", photoUrl);
    }

    console.log("🎯 Final getDeputyDisplayBits result:", {
      resolvedMusicianId,
      photoUrl,
      profileUrl,
    });

    return {
      musicianId: resolvedMusicianId,
      photoUrl,
      profileUrl,
    };
  } catch (e) {
    console.warn("⚠️ getDeputyDisplayBits failed:", e?.message || e);
    const fallbackId =
      (dep?.musicianId && String(dep.musicianId)) ||
      (dep?._id && String(dep._id)) ||
      "";
    const profileUrl = fallbackId
      ? `${PUBLIC_SITE_BASE}/musician/${fallbackId}`
      : "";
    const fallbackPhoto =
      assets.Default_Profile_Picture ||
      `${PUBLIC_SITE_BASE}/default-avatar.png`;
    return { musicianId: fallbackId, photoUrl: fallbackPhoto, profileUrl };
  }
}

// -------------------- SSE Broadcaster --------------------

export const makeAvailabilityBroadcaster = (broadcastFn) => ({
  leadYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({
      type: "availability_yes",
      actId,
      actName,
      musicianName,
      dateISO,
    });
  },
  deputyYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({
      type: "availability_deputy_yes",
      actId,
      actName,
      musicianName,
      dateISO,
    });
  },
  badgeUpdated: ({ actId, actName, dateISO, badge = null }) => {
  broadcastFn({
    type: "availability_badge_updated",
    actId,
    actName,
    dateISO,
    badge, // 👈 now explicitly includes badge or null
  });
},
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
export async function buildAvailabilityBadgeFromRows(act, dateISO) {
  console.log(
    `🟢 (availabilityController.js) buildAvailabilityBadgeFromRows START at ${new Date().toISOString()}`
  );
  if (!act || !dateISO) return null;

  const formattedAddress = act?.formattedAddress || "TBC";
  const rows = await AvailabilityModel.find({ actId: act._id, dateISO })
    .select({ phone: 1, reply: 1, musicianId: 1, updatedAt: 1 })
    .lean();

  if (!Array.isArray(rows) || rows.length === 0) {
    console.warn("⚠️ No availability rows found for", {
      actId: act._id,
      dateISO,
    });
    return null;
  }

  const replyByPhone = new Map();
  for (const r of rows) {
    const p = normalizePhoneE164(r.phone);
    if (!p) continue;
    const rep = String(r.reply || "").toLowerCase();
    const ts = new Date(r.updatedAt || 0).getTime();
    const prev = replyByPhone.get(p);
    if (!prev || ts > prev.ts) replyByPhone.set(p, { reply: rep || null, ts });
  }

  const allLineups = Array.isArray(act.lineups) ? act.lineups : [];

  // 🟢 Check each lineup for vocalists
  for (const l of allLineups) {
    const members = Array.isArray(l.bandMembers) ? l.bandMembers : [];

    for (const m of members) {
      if (!isVocalRoleGlobal(m.instrument)) continue;

      const leadPhone = normalizePhoneE164(m.phoneNumber || m.phone || "");
      const leadReply = leadPhone
        ? replyByPhone.get(leadPhone)?.reply || null
        : null;

      // ✅ Lead said YES → lead badge
      if (leadReply === "yes") {
        const bits = await getDeputyDisplayBits(m);
        const badgeObj = {
          active: true,
          dateISO,
          isDeputy: false,
          inPromo: !!m.inPromo,
          vocalistName: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          musicianId: bits?.musicianId || "",
          photoUrl: bits?.photoUrl || "",
          profileUrl: bits?.profileUrl || "",
          address: formattedAddress,
          setAt: new Date(),
        };
        console.log("🎤 Built lead vocalist badge:", badgeObj);
        return badgeObj;
      }

      // 🚫 Lead said NO/UNAVAILABLE/NONE → look at deputies
      if (!leadReply || leadReply === "no" || leadReply === "unavailable") {
        const deputies = Array.isArray(m.deputies) ? m.deputies : [];
        const yesDeps = [];

        for (const d of deputies) {
          const p = normalizePhoneE164(d.phoneNumber || d.phone || "");
          if (!p) continue;
          const rep = replyByPhone.get(p)?.reply || null;
          if (rep === "yes") yesDeps.push(d);
          if (yesDeps.length >= 3) break;
        }

        if (yesDeps.length > 0) {
          const enriched = [];
          for (const d of yesDeps) {
            const bits = await getDeputyDisplayBits(d);
            enriched.push({
              name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
              musicianId: bits?.musicianId || "",
              photoUrl: bits?.photoUrl || "",
              profileUrl: bits?.profileUrl || "",
              setAt: new Date(),
            });
          }

          const badgeObj = {
            active: true,
            dateISO,
            isDeputy: true,
            inPromo: false,
            deputies: enriched,
            vocalistName: `${m.firstName || ""}`.trim(), // lead name (for context)
            address: formattedAddress,
            setAt: new Date(),
          };
          console.log("🎤 Built deputy badge:", badgeObj);
          return badgeObj;
        }
      }
    }
  }

  console.log("🪶 No badge candidates found — returning null.");
  return null;
}



export async function rebuildAndApplyAvailabilityBadge(reqOrActId, maybeDateISO, act) {
  console.log(
    `🟢 (availabilityController.js) rebuildAndApplyAvailabilityBadge START at ${new Date().toISOString()}`
  );

  const paMap = { smallPa: "small", mediumPa: "medium", largePa: "large" };
  const lightMap = { smallLight: "small", mediumLight: "medium", largeLight: "large" };

  try {
    const actId =
      typeof reqOrActId === "object" ? reqOrActId.body?.actId : reqOrActId;
    const dateISO =
      typeof reqOrActId === "object" ? reqOrActId.body?.dateISO : maybeDateISO;
    if (!actId || !dateISO)
      return { success: false, message: "Missing actId/dateISO" };

    const actDoc = await Act.findById(actId).lean();
    if (!actDoc) return { success: false, message: "Act not found" };

    let badge = await buildAvailabilityBadgeFromRows(actDoc, dateISO);

    // 🧮 Build unique key for this act/date/location combo
    const shortAddress = (badge?.address || actDoc?.formattedAddress || "unknown")
      .replace(/\W+/g, "_")
      .toLowerCase();

    const key = `${dateISO}_${shortAddress}`;

    /* ---------------------------------------------------------------------- */
    /* 🧹 If no badge, clear existing for this key                            */
    /* ---------------------------------------------------------------------- */
    if (!badge) {
      await Act.updateOne(
        { _id: actId },
        { $unset: { [`availabilityBadges.${key}`]: "" } }
      );
      console.log(`🧹 Cleared availability badge for ${actDoc.tscName || actDoc.name}`);

      if (global.availabilityNotify?.badgeUpdated) {
        global.availabilityNotify.badgeUpdated({
          type: "availability_badge_updated",
          actId: String(actId),
          actName: actDoc?.tscName || actDoc?.name,
          dateISO,
          badge: null,
        });
        console.log("📡 SSE broadcasted: availability_badge_updated");
      }
      return { success: true, cleared: true };
    }

    /* ---------------------------------------------------------------------- */
    /* 🎤 ENRICH DEPUTIES WITH FULL MUSICIAN DATA                             */
    /* ---------------------------------------------------------------------- */
    if (Array.isArray(badge.deputies) && badge.deputies.length > 0) {
      console.log(`🎤 Enriching ${badge.deputies.length} deputy entries...`);
      const enrichedDeputies = [];

      for (const dep of badge.deputies) {
        try {
          const musicianId =
            dep.musicianId || dep.musician?._id || dep._id || null;
          if (!musicianId) continue;

          const musician = await Musician.findById(musicianId).lean();
          if (!musician) continue;

          enrichedDeputies.push({
            musicianId: String(musician._id),
            vocalistName: `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
            photoUrl: musician.profilePicture || musician.photoUrl || "",
            profilePicture: musician.profilePicture || musician.photoUrl || "",
            profileUrl:
              musician.profileUrl ||
              `${process.env.PUBLIC_SITE_BASE || "https://meek-biscotti-8d5020.netlify.app"}/musician/${musician._id}`,
            instrument: musician.instrumentation?.[0] || musician.primaryInstrument || "",
            setAt: dep.setAt || new Date(),
          });
        } catch (err) {
          console.warn("⚠️ Failed to enrich deputy:", dep, err.message);
        }
      }

      badge.deputies = enrichedDeputies;
    }

    /* ---------------------------------------------------------------------- */
    /* 🪄 ENRICH ROOT BADGE (deputy case)                                     */
    /* ---------------------------------------------------------------------- */
    if (badge?.isDeputy && badge?.vocalistName && !badge?.photoUrl) {
      const musician = await Musician.findOne({
        $or: [
          { firstName: badge.vocalistName },
          { "aliases.name": badge.vocalistName },
        ],
      }).lean();

      if (musician) {
        badge.photoUrl = musician.profilePicture || musician.photoUrl || "";
        badge.profilePicture = musician.profilePicture || musician.photoUrl || "";
        badge.profileUrl =
          musician.profileUrl ||
          `${process.env.PUBLIC_SITE_BASE || "https://meek-biscotti-8d5020.netlify.app"}/musician/${musician._id}`;
        badge.musicianId = String(musician._id);
      }
    }

    /* ---------------------------------------------------------------------- */
    /* ✅ Apply updated badge                                                 */
    /* ---------------------------------------------------------------------- */
    await Act.updateOne(
      { _id: actId },
      { $set: { [`availabilityBadges.${key}`]: badge } }
    );
console.log(`✅ Applied availability badge for ${actDoc.tscName}:`, badge);

// 🗓️ NEW — send calendar invite to lead vocalist
try {
  if (!badge.vocalistEmail && badge.musicianId) {
    const vocalist = await Musician.findById(badge.musicianId).lean();
    if (vocalist?.email) badge.vocalistEmail = vocalist.email;
  }

  try {
    const { createCalendarInvite } = await import("./googleController.js");

    // Find the musician for email & instrument details
    let musician = null;
    if (badge?.musicianId) {
      musician = await Musician.findById(badge.musicianId).lean();
    }

    const emailForInvite =
      musician?.email ||
      badge?.vocalistEmail ||
      badge?.email ||
      "hello@thesupremecollective.co.uk";
    const role = musician?.instrument || "Lead Vocal";
    const fee =
      musician?.fee ||
      actDoc?.lineups?.[0]?.bandMembers?.find((m) => m.isEssential)?.fee ||
      "TBC";

    const fmtLong = new Date(dateISO).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const enquiryLogged = new Date().toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    await createCalendarInvite({
      enquiryId: `ENQ_${Date.now()}`,
      actId,
      dateISO,
      email: emailForInvite,
      summary: `TSC: ${actDoc.tscName || actDoc.name} enquiry`,
      description: [
        `Event Date: ${fmtLong}`,
        `Act: ${actDoc.tscName || actDoc.name}`,
        `Role: ${role}`,
        `Address: ${badge?.address || actDoc?.formattedAddress || "TBC"}`,
        `Fee: £${fee}`,
        `Enquiry Logged: ${enquiryLogged}`,
      ].join("\n"),
      startTime: `${dateISO}T17:00:00Z`,
      endTime: `${dateISO}T23:59:00Z`,
      fee: fee === "TBC" ? null : fee,
    });

    console.log(
      `✅ Calendar invite created for ${badge?.vocalistName || "Lead"} (${emailForInvite})`
    );
  } catch (calendarErr) {
    console.warn("⚠️ createCalendarInvite failed:", calendarErr.message);
  }
} catch (outerErr) {
  console.warn("⚠️ Outer calendar invite block failed:", outerErr.message);
}
/* ---------------------------------------------------------------------- */
/* ✉️ Send client email (lead YES only)                                   */
/* ---------------------------------------------------------------------- */
if (!badge.isDeputy) {
  try {
    // ✅ Proper client name greeting
    const clientFirstName =
      badge?.clientFirstName ||
      actDoc?.clientName ||
      actDoc?.contactName ||
      "there";

    // ✅ URLs should use FRONTEND_URL
    const SITE =
      process.env.FRONTEND_URL ||
      "https://meek-biscotti-8d5020.netlify.app/";

    const profileUrl = `${SITE}act/${actDoc._id}`;
    const cartUrl = `${SITE}act/${actDoc._id}?date=${dateISO}&address=${encodeURIComponent(
      badge?.address || actDoc?.formattedAddress || ""
    )}`;

    // ✅ Map PA & Lighting size
    const normKey = (s = "") =>
      s.toString().toLowerCase().replace(/[^a-z]/g, "");
    const paMap = { smallpa: "small", mediumpa: "medium", largepa: "large" };
    const lightMap = {
      smalllight: "small",
      mediumlight: "medium",
      largelight: "large",
    };
    const paSize = paMap[normKey(actDoc.paSystem)];
    const lightSize = lightMap[normKey(actDoc.lightingSystem)];

    // ✅ Lead name & hero image
    const vocalistFirst =
      (badge?.vocalistName || "").split(" ")[0] || "our lead vocalist";
    const heroImg =
      (Array.isArray(actDoc.profileImage) &&
        actDoc.profileImage[0]?.url) ||
      (Array.isArray(actDoc.images) && actDoc.images[0]?.url) ||
      actDoc.profileImage?.url ||
      "";

    // ✅ Set durations
    const setsA = Array.isArray(actDoc.numberOfSets)
      ? actDoc.numberOfSets
      : [actDoc.numberOfSets].filter(Boolean);
    const lensA = Array.isArray(actDoc.lengthOfSets)
      ? actDoc.lengthOfSets
      : [actDoc.lengthOfSets].filter(Boolean);
    const setsLine =
      setsA.length && lensA.length
        ? `Up to ${setsA[0]}×${lensA[0]}-minute or ${
            setsA[1] || setsA[0]
          }×${lensA[1] || lensA[0]}-minute live sets`
        : `Up to 3×40-minute or 2×60-minute live sets`;

    /* ---------------------------------------------------------------------- */
    /* 🪄 generateDescription (same as Act.jsx)                               */
    /* ---------------------------------------------------------------------- */
    const generateDescription = (lineup) => {
      if (!lineup) return "";
      const members = lineup.bandMembers || [];
      const essential = members.filter((m) => m.isEssential);
      const instruments = essential
        .map((m) => m.instrument)
        .filter(Boolean);

      const vocals = instruments.filter((i) =>
        i.toLowerCase().includes("vocal")
      );
      const others = instruments.filter(
        (i) => !i.toLowerCase().includes("vocal")
      );

      const vocalText = vocals.length
        ? `${vocals.length}×vocals`
        : null;
      const combined = [vocalText, ...others].filter(Boolean).join(", ");
      const sizeLabel =
        lineup.lineupSize ||
        lineup.actSize ||
        `${essential.length}-Piece`;

      return `${sizeLabel}${combined ? ` (${combined})` : ""}`;
    };

    /* ---------------------------------------------------------------------- */
    /* 💰 lineupQuotes with dynamic pricing                                   */
    /* ---------------------------------------------------------------------- */
  // 🪄 Improved lineup formatting with dynamic travel inclusion
const lineupQuotes = await Promise.all(
  (actDoc.lineups || []).map(async (lu) => {
    const name =
      lu?.actSize ||
      `${(lu?.bandMembers || []).filter((m) => m?.isEssential).length}-Piece`;

    // Replace generic "vocals" with lead female vocal if present
    const instruments = (lu?.bandMembers || [])
      .filter((m) => m?.isEssential)
      .map((m) => {
        const inst = (m?.instrument || "").toLowerCase();
        if (inst.includes("vocal")) return "Lead Female Vocal";
        return m.instrument;
      })
      .filter(Boolean);

    const instrumentList = instruments.join(", ");

    // 🎯 Calculate travel-inclusive total using existing backend logic
    let travelTotal = "";
    try {
      const selectedAddress =
        badge?.address || actDoc?.formattedAddress || "TBC";
      const selectedDate = badge?.dateISO || new Date().toISOString().slice(0, 10);

      const { total, travelCalculated } = await calculateActPricing(
        actDoc,
        "", // selectedCounty optional
        selectedAddress,
        selectedDate,
        lu
      );

      if (total) {
        travelTotal = `from £${Math.round(total)}`;
      }
    } catch (err) {
      console.warn("⚠️ Travel-inclusive price calc failed:", err.message);
    }

    // 💅 Bold the lineup name, normal font for instruments
    return {
      html: `<strong>${name}</strong> (${instrumentList}) — ${travelTotal || "price TBC"}`,
    };
  })
);

    /* ---------------------------------------------------------------------- */
    /* 🎁 Complimentary extras & tailoring                                    */
    /* ---------------------------------------------------------------------- */
    const complimentaryExtras = [];
    if (actDoc?.extras && typeof actDoc.extras === "object") {
      for (const [k, v] of Object.entries(actDoc.extras)) {
        if (v && v.complimentary) {
          complimentaryExtras.push(
            k
              .replace(/_/g, " ")
              .replace(/\s+/g, " ")
              .replace(/^\w/, (c) => c.toUpperCase())
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

        // ✂️ Format address nicely for display (e.g. "Maidenhead, Berkshire")
const makeShortAddress = (addr = "") => {
  if (typeof addr !== "string") return "TBC";
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  if (parts.length === 1) return parts[0];
  return "TBC";
};

const shortAddress = makeShortAddress(
  badge?.address || actDoc?.formattedAddress || actDoc?.venueAddress || ""
);

    /* ---------------------------------------------------------------------- */
    /* ✉️ Send email to client                                                */
    /* ---------------------------------------------------------------------- */
    await sendClientEmail({
      actId: String(actId),
      subject: `Good news — ${actDoc.tscName || actDoc.name}'s lead vocalist is available`,
      html: `
        <div style="font-family: Arial, sans-serif; color:#333; line-height:1.6; max-width:700px; margin:0 auto;">
          <p>Hi ${clientFirstName},</p>

          <p>Thank you for shortlisting <strong>${
            actDoc.tscName || actDoc.name
          }</strong>!</p>

          <p>
            We’re delighted to confirm that <strong>${
              actDoc.tscName || actDoc.name
            }</strong> is available with
            <strong>${vocalistFirst}</strong>, and they’d love to perform for you and your guests.
          </p>

          ${
            heroImg
              ? `<img src="${heroImg}" alt="${
                  actDoc.tscName || actDoc.name
                }" style="width:100%; border-radius:8px; margin:20px 0;" />`
              : ""
          }

          <h3 style="color:#111;">🎵 ${actDoc.tscName || actDoc.name}</h3>
          <p style="margin:6px 0 14px; color:#555;">${
            actDoc.tscDescription || actDoc.description || ""
          }</p>

          <p><a href="${profileUrl}" style="color:#ff6667; font-weight:600;">View Profile →</a></p>

         ${lineupQuotes.length ? `
  <h4 style="margin-top:20px;">Lineup options:</h4>
  <ul>
    ${lineupQuotes.map(l => `<li>${l.html}</li>`).join("")}
  </ul>` : ""}

          <h4 style="margin-top:25px;">Included in your quote:</h4>
          <ul>
            <li>${setsLine}</li>
            ${
              paSize
                ? `<li>A ${paSize} PA system${
                    lightSize ? ` and a ${lightSize} lighting setup` : ""
                  }</li>`
                : ""
            }
            <li>Band arrival from 5pm and finish by midnight as standard</li>
            <li>Or up to 7 hours on site if earlier arrival is needed</li>
            ${complimentaryExtras.map((x) => `<li>${x}</li>`).join("")}
            ${tailoring ? `<li>${tailoring}</li>` : ""}
<li>Travel to ${shortAddress}</li>
          </ul>

          <div style="margin-top:30px;">
            <a href="${cartUrl}" 
              style="background-color:#ff6667; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:600;">
              Add to Cart →
            </a>
          </div>

          <p style="margin-top:20px; color:#555;">
            We operate on a first-booked-first-served basis, so we recommend securing your band quickly to avoid disappointment.
          </p>

          <p>If you have any questions, just reply — we’re always happy to help.</p>

          <p style="margin-top:25px;">
            Warmest wishes,<br/>
            <strong>The Supreme Collective ✨</strong><br/>
            <a href="${SITE}" style="color:#ff6667;">${SITE.replace(
        /^https?:\/\//,
        ""
      )}</a>
          </p>
        </div>
      `,
    });

    console.log("📧 Client email sent (with generateDescription + pricing).");
  } catch (e) {
    console.warn("(availabilityController.js) ⚠️ sendClientEmail failed:", e.message);
  }

    }

    return { success: true, updated: true, badge };
  } catch (err) {
    console.error("❌ rebuildAndApplyAvailabilityBadge error:", err);
    return { success: false, message: err?.message || "Server error" };
  }
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

    const badge = await buildAvailabilityBadgeFromRows(act, dateISO);
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
