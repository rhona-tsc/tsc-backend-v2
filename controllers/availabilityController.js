
import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { createCalendarInvite } from "../controllers/googleController.js";
import { sendSMSMessage, sendWhatsAppText } from "../utils/twilioClient.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { postcodes } from "../utils/postcodes.js"; // <-- ensure this path is correct in backend
import { countyFromOutcode } from "../controllers/helpersForCorrectFee.js";
import Shortlist from "../models/shortlistModel.js";
import sendEmail from "../utils/sendEmail.js";
import User from "../models/userModel.js";

const SMS_FALLBACK_LOCK = new Set(); // key: WA MessageSid; prevents duplicate SMS fallbacks
const normCountyKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, "_");

function classifyReply(text) {
    console.log(`🟢 (availabilityController.js) classifyReply  START at ${new Date().toISOString()}`, {
    actId: req.query?.actId,
    dateISO: req.query?.dateISO, });
  const v = String(text || "").trim().toLowerCase();

  if (!v) return null;

  // YES variants
  if (
    /^(yes|y|yeah|yep|sure|ok|okay)$/i.test(v) ||
    /\bi am available\b/i.test(v) ||
    /\bi'm available\b/i.test(v) ||
    /\bavailable\b/i.test(v)
  ) return "yes";

  // NO variants
  if (
    /^(no|n|nope|nah)$/i.test(v) ||
    /\bi am not available\b/i.test(v) ||
    /\bi'm not available\b/i.test(v) ||
    /\bunavailable\b/i.test(v)
  ) return "no";

  return null;
}
  const toE164 = (raw = "") => {
    let s = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
    if (!s) return "";
    if (s.startsWith("+")) return s;
    if (s.startsWith("07")) return s.replace(/^0/, "+44");
    if (s.startsWith("44")) return `+${s}`;
    return s;
  };
/**
 * Send a client-facing email about act availability.
 * Falls back to hello@thesupremecollective.co.uk if no client email found.
 */
export async function sendClientEmail({ actId, subject, html }) {
  try {
    // Optional: look up the act and its linked user
    const act = await Act.findById(actId).populate("userId", "email").lean();
    const recipient =
      act?.userId?.email || process.env.NOTIFY_EMAIL || "hello@thesupremecollective.co.uk";

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
   console.log(`🟢 (availabilityController.js) parsePayload START at ${new Date().toISOString()}`, {
 });
  // Trim, uppercase, and match "YES<id>" / "NOLOC<id>" / "UNAVAILABLE<id>"
  const match = payload.trim().match(/^(YES|NOLOC|UNAVAILABLE)([A-Za-z0-9]+)?$/i);
  if (!match) return { reply: null, enquiryId: null };
  return {
    reply: match[1].toLowerCase(),
    enquiryId: match[2] || null,
  };
}
const normalizeFrom = (from) => {
   console.log(`🟢 (availabilityController.js) normalizeFrom START at ${new Date().toISOString()}`, {
 });
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
   console.log(`🟢 (availabilityController.js) normalizeToE164 START at ${new Date().toISOString()}`, {
 });
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};
function getCountyFeeValue(countyFees, countyName) {
  console.log(`🟢 (availabilityController.js) getCountyFeeValue  START at ${new Date().toISOString()}`, {
   });
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
  console.log(`🟢 (availabilityController.js) safeFirst START at ${new Date().toISOString()}`
  );
  const v = String(s || "").trim();
  return v ? v.split(/\s+/)[0] : "there";
};


function extractOutcode(address = "") {
  console.log(`🟢 (availabilityController.js) extractOutcode  START at ${new Date().toISOString()}`, {
 });
  // Typical UK outcode patterns e.g. SL6, W1, SW1A, B23
  const s = String(address || "").toUpperCase();
  // Prefer the first token that looks like a postcode piece
  // Full PC can be "SL6 8HN". Outcode is "SL6".
  const m = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/); // full PC
  if (m) return m[1];
  const o = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/); // fallback: any outcode-like token
  return o ? o[1] : "";
}

function countyFromAddress(address = "") {
    console.log(`🟢 (availabilityController.js) countyFromAddress START at ${new Date().toISOString()}`, {
 });
  // pull something like SL6, W1, SW1A from the address
  const outcode = extractOutcode(address).toUpperCase();
  if (!outcode) return { outcode: "", county: "" };

  // your export is: export const postcodes = [ { county: [OUTCODES...] } ];
  const table = Array.isArray(postcodes) ? (postcodes[0] || {}) : (postcodes || {});

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
    console.log(`🟢 (availabilityController.js) getPictureUrlFrom START at ${new Date().toISOString()}`, {
 });
  if (typeof obj.profilePicture === "string" && obj.profilePicture.trim().startsWith("http")) {
    return obj.profilePicture;
  }
  return "";
};

// Build the exact SMS text we want for both send-time and fallback - THIS IS THE SMS TO LEAD VOCALISTS TO CHECK AVAILABILITY! (not used for booking confirmations)
function buildAvailabilitySMS({ firstName, formattedDate, formattedAddress, fee, duties, actName }) {
    console.log(`🟢 (availabilityController.js) buildAvailabilitySMS START at ${new Date().toISOString()}`, {
 });
  const feeTxt = String(fee ?? '').replace(/^[£$]/, '');
  return (
    `Hi ${safeFirst(firstName)}, you've received an enquiry for a gig on ` +
    `${formattedDate || "the date discussed"} in ${formattedAddress || "test 3 the area"} ` +
    `at a rate of £${feeTxt || "TBC"} for ${duties || "performance"} duties ` +
    `with ${actName || "the band"}. Please indicate your availability 💫 ` +
    `Reply YES / NO.`
  );
}

// === Booking-request wave (uses the SAME fee logic as enquiries) ===

// Compute a per-member final fee exactly like the enquiry flow:
// - explicit member.fee if set, else per-head from lineup.base_fee
// - plus county travel fee (if enabled) OR distance-based travel
async function _finalFeeForMember({ act, lineup, members, member, address, dateISO }) {
   console.log(`🟢 (availabilityController.js) _finalFeeForMember START at ${new Date().toISOString()}`, {
 });
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
   console.log(`🟢 (availabilityController.js) isVocalRoleGlobal START at ${new Date().toISOString()}`, {
 });
  const r = String(role || "").toLowerCase();
  return [
    "lead male vocal", "lead female vocal", "lead vocal",
    "vocalist-guitarist", "vocalist-bassist", "mc/rapper",
    "lead male vocal/rapper", "lead female vocal/rapper",
    "lead male vocal/rapper & guitarist", "lead female vocal/rapper & guitarist",
  ].includes(r);
};




// --- New helpers for badge rebuilding ---


const normalizePhoneE164 = (raw = "") => {
   console.log(`🟢 (availabilityController.js) normalisePhoneE164 START at ${new Date().toISOString()}`, {
 });
  let v = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

export const clearavailabilityBadges = async (req, res) => {
   console.log(`🟢 (availabilityController.js) cleadavailabilityBadges START at ${new Date().toISOString()}`, {
 });
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
   console.log(`🟢  (availabilityController.js) mapTwilioToEnquiryStatus START at ${new Date().toISOString()}`, {
 });
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

 const BASE_URL = (process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || process.env.INTERNAL_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
;

const NORTHERN_COUNTIES = new Set([
"ceredigion", "cheshire", "cleveland", "conway", "cumbria", "denbighshire", "derbyshire", "durham", "flintshire", "greater manchester", "gwynedd", "herefordshire", "lancashire", "leicestershire", "lincolnshire", "merseyside", "north humberside", "north yorkshire", "northumberland", "nottinghamshire", "rutland", "shropshire", "south humberside", "south yorkshire", "staffordshire", "tyne and wear", "warwickshire", "west midlands", "west yorkshire", "worcestershire", "wrexham", "rhondda cynon taf", "torfaen", "neath port talbot", "bridgend", "blaenau gwent", "caerphilly", "cardiff", "merthyr tydfil", "newport", "aberdeen city", "aberdeenshire", "angus", "argyll and bute", "clackmannanshire", "dumfries and galloway", "dundee city", "east ayrshire", "east dunbartonshire", "east lothian", "east renfrewshire", "edinburgh", "falkirk", "fife", "glasgow", "highland", "inverclyde", "midlothian", "moray", "na h eileanan siar", "north ayrshire", "north lanarkshire", "orkney islands", "perth and kinross", "renfrewshire", "scottish borders", "shetland islands", "south ayrshire", "south lanarkshire", "stirling", "west dunbartonshire", "west lothian"
]);



// Availability controller: robust travel fetch that supports both API shapes
const fetchTravel = async (origin, destination, dateISO) => {
   console.log(`🟢 (availabilityController.js) fetchTravel START at ${new Date().toISOString()}`, {
 });
  const BASE = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.INTERNAL_BASE_URL ||
    "http://localhost:4000"
  ).replace(/\/+$/, "");

  const url = `${BASE}/api/v2/travel` +
    `?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&date=${encodeURIComponent(dateISO)}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }

  if (!res.ok) throw new Error(`travel http ${res.status}`);

  // --- Normalize shapes ---
  // Legacy: { rows:[{ elements:[{ distance, duration, fare? }] }] }
  const firstEl = data?.rows?.[0]?.elements?.[0];

  // Prefer new shape if present; otherwise build outbound from legacy element
  const outbound = data?.outbound || (
    firstEl?.distance && firstEl?.duration
      ? { distance: firstEl.distance, duration: firstEl.duration, fare: firstEl.fare }
      : undefined
  );

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
   console.log(`🟢 (availabilityController.js) computeMemberTravelFee START at ${new Date().toISOString()}`, {
 });
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
  console.log(`🐠 (controllers/shortlistController.js) findVocalistPhone called at`, new Date().toISOString(), {
  lineupId,
  totalLineups: actData?.lineups?.length || 0,
});
  if (!actData?.lineups?.length) return null;

  // Prefer specified lineupId
  const lineup = lineupId
    ? actData.lineups.find(l => String(l._id || l.lineupId) === String(lineupId))
    : actData.lineups[0];

  if (!lineup?.bandMembers?.length) return null;

  // Find first member with instrument containing "vocal"
  const vocalist = lineup.bandMembers.find(m =>
    String(m.instrument || "").toLowerCase().includes("vocal")
  );

  if (!vocalist) return null;

  // Safely pick phone fields
  let phone = vocalist.phoneNormalized || vocalist.phoneNumber || "";
  if (!phone && Array.isArray(vocalist.deputies) && vocalist.deputies.length) {
    phone = vocalist.deputies[0].phoneNormalized || vocalist.deputies[0].phoneNumber || "";
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

return { vocalist, phone };}

// handle status callback from Twilio


// ✅ main function

export const shortlistActAndTriggerAvailability = async (req, res) => {
  try {
    console.log("🎯 (shortlistController.js) shortlistActAndTriggerAvailability START at", new Date().toISOString(), {
      body: req.body,
    });

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
  console.log(`🟢 (availabilityController.js) triggerAvailabilityRequest START at ${new Date().toISOString()}`, {});
  try {
    console.log("🛎 triggerAvailabilityRequest", req.body);

    const { actId, lineupId, date, address } = req.body;
    if (!actId || !date || !address) {
      return res.status(400).json({ success: false, message: "Missing actId/date/address" });
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
      console.log("⛔ Already triggered for act/date/address:", existingEnquiry.dateISO, existingEnquiry.formattedAddress);
      return res.json({ success: true, skipped: true, message: "Duplicate prevented" });
    }

    // Continue if no duplicate found
    const act = await Act.findById(actId).lean();
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

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

    const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];

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

    // 1) Availability state for this act/date across all contacts
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
      else {
        const existing = pending.get(p);
        if (!existing) pending.set(p, r);
        else {
          const a = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
          const b = new Date(r.updatedAt || r.createdAt || 0).getTime();
          if (b > a) pending.set(p, r);
        }
      }
    }

    const negatives = new Set([...repliedNo.keys()]);
    const alreadyPingedSet = new Set([...repliedYes.keys(), ...pending.keys(), ...negatives.keys()]);

    console.log("🚫 Known-unavailable:", [...negatives]);
    console.log("🔁 Already pinged (act/date scoped):", [...alreadyPingedSet]);

    // 2) Vocal lead
    const found = findVocalistPhone(act, lineupId);
    if (!found?.vocalist || !found?.phone) {
      return res.json({
        success: true,
        message: "No vocalist with valid phone found",
      });
    }

    const lead = found.vocalist;
    const phone = found.phone;

    // 3) fee helper
    const feeForMember = async (member) => {
      const baseFee = Number(member?.fee ?? 0);
      const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
      const membersCount = Math.max(1, (Array.isArray(members) ? members.length : 0) || 1);
      const perHead = lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
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

    // 4) Decide who to ping
    let sentCount = 0;
    const finalFee = await feeForMember(lead);
    const phoneNorm = normalizePhone(phone);

    if (negatives.has(phoneNorm)) {
      console.log("⏭️ Lead already marked unavailable — skipping.");
      return res.json({ success: true, skipped: true, reason: "lead_unavailable" });
    }

    if (!phoneNorm) {
      console.warn("⚠️ Lead has no usable phone, skipping.");
      return res.json({ success: false, message: "No phone for vocalist" });
    }

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
        payload: {
          to: phoneNorm,
          templateParams: {
            FirstName: firstNameOf(lead),
            FormattedDate: formattedDate,
            FormattedAddress: shortAddress,
            Fee: String(finalFee),
            Duties: lead.instrument || "Lead Vocal",
            ActName: act.tscName || act.name || "the band",
            MetaActId: String(act._id || ""),
            MetaISODate: dateISO,
            MetaAddress: shortAddress,
          },
          smsBody:
            `Hi ${firstNameOf(lead)}, you've received an enquiry for a gig on ` +
            `${formattedDate} in ${shortAddress} at a rate of £${String(finalFee)} for ` +
            `${lead.instrument} duties with ${act.tscName}. Please reply YES / NO.`,
        },
      });

      console.log("⏸️ Deferred enquiry due to active pending for this phone.");
      return res.json({
        success: true,
        deferred: true,
        message: "Pending enquiry active — deferred send.",
      });
    }

    // ✅ Actual WhatsApp/SMS send
    const smsBody =
      `Hi ${firstNameOf(lead)}, you've received an enquiry for a gig on ` +
      `${formattedDate} in ${shortAddress} at a rate of £${String(finalFee)} for ` +
      `${lead.instrument} duties with ${act.tscName}. Please reply YES / NO.`;

    const contentSid = process.env.TWILIO_ENQUIRY_SID;
    console.log("🚀 Attempting to send WhatsApp message to", phoneNorm);

    try {
      const sendRes = await sendWhatsAppMessage({
        to: `whatsapp:${phoneNorm}`,
        contentSid,
        variables: {
          "1": firstNameOf(lead),
          "2": formattedDate,
          "3": shortAddress,
          "4": String(finalFee),
          "5": lead.instrument || "performance",
          "6": act.tscName || act.name || "the band",
        },
        smsBody,
      });

      console.log("✅ WhatsApp send finished:", sendRes);
      sentCount++;
    } catch (err) {
      console.warn("⚠️ WhatsApp send failed:", err.message);
    }

    return res.json({
      success: true,
      sent: sentCount,
      note: sentCount === 0 ? "No one pinged (all leads unavailable and no deputy found)." : undefined,
    });
  } catch (err) {
    console.error("triggerAvailabilityRequest error:", err);
    return res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
};


  // -------------------- Delivery/Read Receipts --------------------
// module-scope guard so we don't double-fallback on Twilio retries
export const twilioStatus = async (req, res) => {
  console.log(`🟢 (availabilityController.js) twilioStatus START at ${new Date().toISOString()}`, {});
  try {
    const {
      MessageSid,
      MessageStatus,      // delivered, failed, undelivered, read, sent, queued, etc.
      SmsStatus,          // sometimes used instead of MessageStatus
      To,                 // e.g. whatsapp:+447...
      From,               // your sender e.g. whatsapp:+1555...
      ErrorCode,
      ErrorMessage,
    } = req.body || {};

    const status = String(
      req.body?.MessageStatus ??
      req.body?.SmsStatus ??
      req.body?.message_status ??
      ""
    ).toLowerCase();

    const isWA   = /^whatsapp:/i.test(String(From || "")); // channel we used
    const toAddr = String(To || "");                        // "whatsapp:+44…" OR "+44…"

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



export const twilioInbound = async (req, res) => {
  console.log(`🟢 [twilioInbound] START at ${new Date().toISOString()}`);

  try {
    console.log("📬 Raw inbound req.body:", req.body);

    // Extract inbound WhatsApp payload only
    const bodyText = String(req.body?.Body || "");
    const buttonText = String(req.body?.ButtonText || "");
    const buttonPayload = String(req.body?.ButtonPayload || "");
    const inboundSid = String(req.body?.MessageSid || "");
    const fromRaw = String(req.body?.WaId || req.body?.From || "").replace(/^whatsapp:/i, "");
    const toRaw = String(req.body?.To || "").replace(/^whatsapp:/i, "");

    console.log("📩 Incoming WhatsApp message:", {
      From: fromRaw,
      Body: bodyText,
      ButtonText: buttonText,
      ButtonPayload: buttonPayload,
      MessageSid: inboundSid,
    });

    // Dedup check
    if (seenInboundOnce(inboundSid)) {
      console.log("🪵 Duplicate inbound — already handled", { MessageSid: inboundSid });
      return res.status(200).send("<Response/>");
    }

    // Skip if empty
    const noContent = !buttonPayload && !buttonText && !bodyText;
    if (noContent) {
      console.log("🪵 Ignoring empty inbound message", { From: fromRaw });
      return res.status(200).send("<Response/>");
    }

    // Prevent double processing of same SID in DB
    if (inboundSid) {
      console.log("🔎 Checking for existing inbound SID in DB:", inboundSid);
      const dup = await AvailabilityModel.findOne({ "inbound.sid": inboundSid }).lean();
      console.log("🔍 Duplicate check result:", !!dup);
      if (dup) {
        console.log("🪵 Duplicate inbound detected in DB, skipping:", inboundSid);
        return res.status(200).send("<Response/>");
      }
    }

    // Parse reply
    const combinedText = `${buttonText} ${buttonPayload} ${bodyText}`.trim();
    console.log("🧩 Combined text:", combinedText);

    let { reply, enquiryId } = parsePayload(buttonPayload);
    console.log("🔍 parsePayload output:", { reply, enquiryId });

    if (!reply) reply = classifyReply(buttonText) || classifyReply(bodyText) || null;
    console.log("🤖 Classified reply after fallback:", reply);

    if (!reply) {
      console.log("🤷 Unrecognised WhatsApp reply, ignoring:", combinedText);
      return res.status(204).send("<Response/>");
    }

    console.log("🔎 Searching for matching AvailabilityModel document...");

    // Find and update corresponding availability row
    let updated = null;
    if (enquiryId) {
      updated = await AvailabilityModel.findOneAndUpdate(
        { enquiryId },
        {
          $set: {
            reply,
            repliedAt: new Date(),
            "inbound.sid": inboundSid,
            "inbound.body": bodyText,
            "inbound.buttonText": buttonText,
            "inbound.buttonPayload": buttonPayload,
          },
        },
        { new: true }
      );
      console.log("🧾 Updated via enquiryId match:", updated ? updated._id : "none");
    }

    if (!updated) {
      const candidates = normalizeFrom(fromRaw);
      console.log("🔍 Fallback: normalizeFrom produced:", candidates);
      if (candidates.length) {
        updated = await AvailabilityModel.findOneAndUpdate(
          { phone: { $in: candidates } },
          {
            $set: {
              reply,
              repliedAt: new Date(),
              "inbound.sid": inboundSid,
              "inbound.body": bodyText,
              "inbound.buttonText": buttonText,
              "inbound.buttonPayload": buttonPayload,
            },
          },
          { sort: { createdAt: -1 }, new: true }
        );
        console.log("🧾 Updated via phone match:", updated ? updated._id : "none");
      }
    }

// Load act + resolve musician
const act = updated?.actId ? await Act.findById(updated.actId).lean() : null;

let musician = null;

// First try direct musicianId lookup
if (updated?.musicianId) {
  musician = await Musician.findById(updated.musicianId).lean();
}

// 🔁 Fallback: if missing, lookup by phone number
if (!musician && updated?.phone) {
  musician = await Musician.findOne({
    $or: [
      { phone: updated.phone },
      { whatsappNumber: updated.phone },
      { "contact.phone": updated.phone },
    ],
  }).lean();

  if (musician) {
    console.log("🔁 Fallback musician lookup succeeded:", musician.email);
    // Backfill missing musicianId for future lookups
    await AvailabilityModel.updateOne(
      { _id: updated._id },
      { $set: { musicianId: musician._id } }
    );
  }
}

// 🧩 NEW fallback: use findVocalistPhone() if still no musician
if (!musician && act) {
  const vocalistData = findVocalistPhone(act, updated?.lineupId);
  if (vocalistData?.vocalist) {
    console.log("🎙️ Using fallback vocalist from act data:", {
      name: `${vocalistData.vocalist.firstName} ${vocalistData.vocalist.lastName}`,
      phone: vocalistData.phone,
      email: vocalistData.vocalist.email,
    });
    musician = {
      _id: vocalistData.vocalist._id,
      firstName: vocalistData.vocalist.firstName,
      lastName: vocalistData.vocalist.lastName,
      email: vocalistData.vocalist.email,
      phone: vocalistData.phone,
    };
  }
}

if (!musician) {
  console.warn("⚠️ No musician found for phone", updated?.phone);
}

console.log("🎭 Loaded act + musician:", {
  actFound: !!act,
  actName: act?.tscName || act?.name,
  musicianFound: !!musician,
  musicianName: musician?.firstName || musician?.fullName,
  musicianEmail: musician?.email,
});

const toE164 = normalizeToE164(updated.phone || fromRaw);
const dateISOday = String((updated.dateISO || "").slice(0, 10));
const emailForInvite = musician?.email || updated.calendarInviteEmail || null;

    console.log("🧮 Derived calendar invite info:", {
      toE164,
      dateISOday,
      emailForInvite,
    });

    // --- YES reply ---
    if (reply === "yes") {
      try {
        console.log("✅ YES reply received via WhatsApp");
        const formattedDateString = dateISOday
          ? new Date(dateISOday).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          : "the date discussed";
        console.log("📅 Formatted date string:", formattedDateString);

        // 🗓️ Create calendar invite if possible
        if (emailForInvite && dateISOday && act) {
          console.log("📨 Attempting to create calendar invite...");
          const desc = [
            `TSC enquiry logged: ${new Date(updated.createdAt || Date.now()).toLocaleString("en-GB")}`,
            `Act: ${act.tscName || act.name}`,
            `Role: ${updated.duties || ""}`,
            `Address: ${updated.formattedAddress || ""}`,
            `Date: ${formattedDateString}`,
          ].join("\n");

          try {
            const event = await createCalendarInvite({
              enquiryId: updated.enquiryId || `ENQ_${Date.now()}`,
              actId: String(act._id),
              dateISO: dateISOday,
              email: emailForInvite,
              summary: `TSC: ${act.tscName || act.name} enquiry`,
              description: desc,
              startTime: `${dateISOday}T17:00:00Z`,
              endTime: `${dateISOday}T23:59:00Z`,
            });

            console.log("📆 createCalendarInvite response:", event);

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

            console.log("📆 Calendar invite created for:", {
              emailForInvite,
              eventId: event?.id || event?.data?.id,
            });
          } catch (err) {
            console.warn("⚠️ Calendar invite failed:", err.message, err.stack);
          }
        } else {
          console.log("⏭️ Skipping calendar invite — missing required fields", {
            emailForInvite,
            dateISOday,
            actPresent: !!act,
          });
        }

        // ✅ WhatsApp confirmation
        console.log("📲 Sending confirmation WhatsApp message...");
        await sendWhatsAppText(
          toE164,
          "Super — we’ll send a diary invite to log the enquiry for your records."
        );
        console.log("✅ WhatsApp confirmation sent.");

        console.log("🟡 Rebuilding availability badge...");
        await rebuildAndApplyAvailabilityBadge(
          { body: { actId: String(updated.actId), dateISO: updated.dateISO } },
          { json: (r) => console.log("✅ Badge refreshed:", r), status: () => ({ json: () => {} }) }
        );
      } catch (err) {
        console.error("❌ Error handling YES reply:", err.message, err.stack);
      }

      console.log("✅ [twilioInbound] END (YES branch)");
      return res.status(200).send("<Response/>");
    }

    // --- NO / UNAVAILABLE ---
    if (["no", "unavailable"].includes(reply)) {
      console.log(`🚫 Handling ${reply.toUpperCase()} reply`);
      try {
        await Act.updateOne(
          { _id: updated.actId },
          {
            $set: { "availabilityBadges.active": false },
            $unset: {
              "availabilityBadges.vocalistName": "",
              "availabilityBadges.photoUrl": "",
              "availabilityBadges.musicianId": "",
              "availabilityBadges.dateISO": "",
              "availabilityBadges.setAt": "",
            },
          }
        );
await rebuildAndApplyAvailabilityBadge(updated.actId, updated.dateISO);
        console.log("🧹 Cleared badge for act:", updated.actId);

        await sendWhatsAppText(toE164, "Thanks for letting us know — we’ve updated your availability!");
        console.log("📲 Confirmation WhatsApp sent for NO/UNAVAILABLE");

        if (act && typeof handleLeadNegativeReply === "function") {
          console.log("🔁 Calling handleLeadNegativeReply...");
          await handleLeadNegativeReply({ act, updated, fromRaw });
        }

        console.log("🏷️ Completed NO/UNAVAILABLE processing");
      } catch (err) {
        console.error("❌ Error processing NO/UNAVAILABLE:", err.message, err.stack);
      }

      console.log("✅ [twilioInbound] END (NO/UNAVAILABLE branch)");
      return res.status(200).send("<Response/>");
    }

    // --- NOLOC (Not for this location) ---
if (reply === "noloc") {
  try {
    console.log("🚫 Handling NOLOC (Not for this location) reply");

    // Clear badge since lead isn’t doing this location
    await Act.updateOne(
      { _id: updated.actId },
      {
        $set: { "availabilityBadges.active": false },
        $unset: {
          "availabilityBadges.vocalistName": "",
          "availabilityBadges.photoUrl": "",
          "availabilityBadges.musicianId": "",
          "availabilityBadges.dateISO": "",
          "availabilityBadges.setAt": "",
          "availabilityBadges.address": "",
        },
      }
    );

    // Optional: refresh badge + trigger deputies
    await rebuildAndApplyAvailabilityBadge(updated.actId, updated.dateISO);
    await handleLeadNegativeReply({ act, updated, fromRaw });

    await sendWhatsAppText(
      normalizeToE164(updated.phone || fromRaw),
      "Thanks for letting us know — we’ll check with your deputies for this location."
    );

    console.log("✅ Completed NOLOC processing");
  } catch (err) {
    console.error("❌ Error processing NOLOC:", err.message);
  }

  return res.status(200).send("<Response/>");
}

    console.log(`✅ Processed WhatsApp reply: ${reply}`);
    console.log("✅ [twilioInbound] END (fallback branch)");
    return res.status(200).send("<Response/>");
  } catch (err) {
    console.error("❌ Error in twilioInbound:", err.message, err.stack);
    return res.status(200).send("<Response/>");
  }
};

const INBOUND_SEEN = new Map(); 
const INBOUND_TTL_MS = 10 * 60 * 1000; 

function seenInboundOnce(sid) {
   console.log(`🟢 (availabilityController.js) seenInboundOnce START at ${new Date().toISOString()}`, {
 });
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
   console.log(`🟢 (availabilityController.js) formatWithOrdinal START at ${new Date().toISOString()}`, {
 });
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
   console.log(`🟢 (availabilityController.js) firstNameOf START at ${new Date().toISOString()}`, {
 });
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

async function getDeputyDisplayBits(dep) {
  console.log(`🟢 (availabilityController.js) getDeputyDisplayBits START at ${new Date().toISOString()}`, {
    depKeys: Object.keys(dep || {}),
    depMusicianId: dep?.musicianId,
    depEmail: dep?.email,
    depName: `${dep?.firstName || ""} ${dep?.lastName || ""}`.trim(),
  });

  const PUBLIC_SITE_BASE = (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");

  try {
    // Prefer an explicit musicianId if present
    const musicianId = (dep?.musicianId && String(dep.musicianId)) || (dep?._id && String(dep._id)) || "";

    // 1️⃣ Direct photo on deputy
    let photoUrl = getPictureUrlFrom(dep);
    console.log("📸 Step 1: Direct deputy photoUrl →", photoUrl || "❌ none");

    // 2️⃣ Lookup by musicianId
    let mus = null;
    if (!photoUrl && musicianId) {
      mus = await Musician.findById(musicianId)
        .select("musicianProfileImageUpload musicianProfileImage profileImage profilePicture.url photoUrl imageUrl email")
        .lean();
      photoUrl = getPictureUrlFrom(mus || {});
      console.log("📸 Step 2: Lookup by musicianId →", photoUrl || "❌ none");
    }

    // 3️⃣ Lookup by email (deputy email > mus.email)
    if (!photoUrl) {
      const email = dep?.email || dep?.emailAddress || mus?.email || "";
      console.log("📧 Step 3: Lookup by email →", email || "❌ none");
      if (email) {
        const musByEmail = await Musician.findOne({ email })
          .select("musicianProfileImageUpload musicianProfileImage profileImage profilePicture.url photoUrl imageUrl _id email")
          .lean();
        if (musByEmail) {
          photoUrl = getPictureUrlFrom(musByEmail);
          console.log("📸 Step 3 result: Found via email →", photoUrl);
          if (!musicianId && musByEmail._id) {
            dep.musicianId = musByEmail._id; // non-persistent enrichment
          }
        } else {
          console.warn("⚠️ Step 3: No musician found for email", email);
        }
      }
    }

    // 4️⃣ Build final output
    const resolvedMusicianId = (dep?.musicianId && String(dep.musicianId)) || musicianId || "";
    const profileUrl = resolvedMusicianId ? `${PUBLIC_SITE_BASE}/musician/${resolvedMusicianId}` : "";
    console.log("🎯 Final getDeputyDisplayBits result:", {
      resolvedMusicianId,
      photoUrl,
      profileUrl,
    });

    return {
      musicianId: resolvedMusicianId,
      photoUrl: photoUrl || "",
      profileUrl,
    };
  } catch (e) {
    console.warn("⚠️ getDeputyDisplayBits failed:", e?.message || e);
    const fallbackId = (dep?.musicianId && String(dep.musicianId)) || (dep?._id && String(dep._id)) || "";
    const profileUrl = fallbackId ? `${PUBLIC_SITE_BASE}/musician/${fallbackId}` : "";
    return { musicianId: fallbackId, photoUrl: "", profileUrl };
  }
}

// -------------------- SSE Broadcaster --------------------

export const makeAvailabilityBroadcaster = (broadcastFn) => (
  {
  
  leadYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({type: "availability_yes",actId,actName,musicianName,dateISO,});  },
  deputyYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({ type: "availability_deputy_yes", actId,  actName, musicianName,dateISO, });},});

    // one-shot WA→SMS for a single deputy
export async function handleLeadNegativeReply({ act, updated, fromRaw = "" }) {
  console.log(`🟢 (availabilityController.js) handleLeadNegativeReply START`);
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
              contactChannel: sendRes?.channel || row?.contactChannel || "whatsapp",
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
        console.log("✅ Deputy pinged");
        freshPinged++;
      } catch (e) {
        console.warn("⚠️ Failed to notify deputy", e?.message || e);
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
  console.log(`🟢 (availabilityController.js) notifyDeputyOneShot START`);
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
  const toWA = (raw = "") => {
    const e164 = toE164(raw);
    return e164 ? `whatsapp:${e164}` : "";
  };

  try {
    // phones
    const phoneRaw   = deputy?.phoneNumber || deputy?.phone || "";
    const phoneE164  = toE164(phoneRaw);          // +44…
    const phoneWA    = toWA(phoneRaw);            // whatsapp:+44…
    if (!phoneE164) {
      console.warn("❌ notifyDeputyOneShot(): Deputy has no usable phone");
      throw new Error("Deputy has no phone");
    }

    // enquiry id
    const enquiryId = String(Date.now());

    // ensure an Availability stub exists (and capture identity fields)
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
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // WhatsApp template params
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
    console.log("📦 WhatsApp template params:", templateParams);

    console.log("📤 Sending WhatsApp to deputy…");
    const sendRes = await sendWhatsAppMessage({
      to: phoneWA,
      templateParams,
    });

    // persist outbound details for webhook lookup
    await AvailabilityModel.updateOne(
      { _id: availabilityDoc._id },
      {
        $set: {
          status: sendRes?.status || "queued",
          messageSidOut: sendRes?.sid || null,
          contactChannel: sendRes?.channel || "whatsapp",
          updatedAt: new Date(),
          "outbound.sid": sendRes?.sid || null,
        },
      }
    );

    // record a row in EnquiryMessage (handy for analytics / auditing)
    const first = firstNameOf(deputy);
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
        firstName: first,
        actName: act?.tscName || act?.name || "the band",
      },
      templateParams,
    });

    console.log("✅ Deputy pinged");
    return { phone: phoneE164, enquiryId };
  } catch (err) {
    console.error("⚠️ Failed to notify deputy", err?.message || err);
    throw err;
  }
}

export async function pingDeputiesFor(actId, lineupId, dateISO, formattedAddress, duties) {
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

async function buildAvailabilityBadgeFromRows(act, dateISO) {
  console.log(`🟢 (availabilityController.js) buildAvailabilityBadgeFromRows START at ${new Date().toISOString()}`);
  if (!act || !dateISO) return null;

  const rows = await AvailabilityModel.find({ actId: act._id, dateISO })
    .select({ phone: 1, reply: 1, musicianId: 1, updatedAt: 1 })
    .lean();

  if (!Array.isArray(rows) || rows.length === 0) {
    console.warn("⚠️ No availability rows found for", { actId: act._id, dateISO });
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
  for (const l of allLineups) {
    const members = Array.isArray(l.bandMembers) ? l.bandMembers : [];
    for (const m of members) {
      if (!isVocalRoleGlobal(m.instrument)) continue;

      const leadPhone = normalizePhoneE164(m.phoneNumber || m.phone || "");
      const leadReply = leadPhone ? replyByPhone.get(leadPhone)?.reply || null : null;

      // ✅ Lead said YES → primary badge
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
          address: act?.availabilityBadges?.address || "",
          setAt: new Date(),
        };
        console.log("🎤 Built lead vocalist badge:", badgeObj);
        return badgeObj;
      }

      // 🚫 Lead said NO → look at deputies
      if (leadReply === "no" || leadReply === "unavailable") {
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
            vocalistName: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
            address: act?.availabilityBadges?.address || "",
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
  
export async function rebuildAndApplyAvailabilityBadge(reqOrActId, maybeDateISO) {
  console.log(`🟢 (availabilityController.js) rebuildAndApplyAvailabilityBadge START at ${new Date().toISOString()}`);

  try {
    const actId = typeof reqOrActId === "object" ? reqOrActId.body?.actId : reqOrActId;
    const dateISO = typeof reqOrActId === "object" ? reqOrActId.body?.dateISO : maybeDateISO;
    if (!actId || !dateISO) return { success: false, message: "Missing actId/dateISO" };

    const act = await Act.findById(actId).lean();
    if (!act) return { success: false, message: "Act not found" };

    const badge = await buildAvailabilityBadgeFromRows(act, dateISO);

    // 🧹 If no badge, clear existing
    if (!badge) {
      await Act.updateOne(
        { _id: actId },
        {
          $set: {
            availabilityBadges: {
              active: false,
              clearedAt: new Date(),
            },
          },
          $unset: {
            "availabilityBadges.vocalistName": "",
            "availabilityBadges.inPromo": "",
            "availabilityBadges.isDeputy": "",
            "availabilityBadges.photoUrl": "",
            "availabilityBadges.musicianId": "",
            "availabilityBadges.dateISO": "",
            "availabilityBadges.address": "",
            "availabilityBadges.deputies": "",
            "availabilityBadges.setAt": "",
          },
        }
      );
      console.log(`🧹 Cleared availability badge for ${act.tscName || act.name}`);
      return { success: true, cleared: true };
    }

    // 🚧 Guard: ensure badge is a proper object
    if (typeof badge !== "object" || badge === null || Array.isArray(badge)) {
      console.warn("⚠️ Skipping badge update — invalid badge format:", badge);
      return { success: false, message: "Invalid badge format" };
    }

    // ✅ Apply new badge
    await Act.updateOne({ _id: actId }, { $set: { availabilityBadges: badge } });
    console.log(`✅ Applied availability badge for ${act.tscName || act.name}:`, badge);

    // 📧 Send client email (lead YES only)
    if (!badge.isDeputy) {
      try {
        await sendClientEmail({
          actId,
          subject: `Good news — ${act?.tscName || act?.name || "The band"} lead vocalist is available`,
          html: `<p>${badge.vocalistName || "Lead vocalist"} is free for ${dateISO}.</p>`,
        });
        console.log("(availabilityController.js) 📧 Client email sent for lead YES.");
      } catch (e) {
        console.warn("(availabilityController.js) ⚠️ sendClientEmail failed:", e.message);
      }

      // 📅 Google Calendar invite
      try {
        if (badge?.musicianId) {
          const musician = await Musician.findById(badge.musicianId).lean();
          if (musician?.email) {
            console.log("(availabilityController.js) 📅 Sending Google Calendar invite...");
            try {
              await createCalendarInvite({
                actId,
                dateISO,
                email: musician.email,
                summary: `TSC Enquiry: ${act.tscName || act.name}`,
                description: `You have confirmed availability for performing with ${act.tscName || act.name} on ${dateISO} at a rate of £${badge?.fee || "TBC"}.\n\nIf you become unavailable please inform us by declining the calendar invite.\n\nThank you!`,
                startTime: new Date(`${dateISO}T17:00:00Z`),
                endTime: new Date(`${dateISO}T23:00:00Z`),
                address: act?.eventLocation || "TBC",
              });
              console.log("(availabilityController.js) ✅ Calendar invite sent successfully.");
            } catch (err) {
              console.warn("(availabilityController.js) ⚠️ Calendar invite failed:", err?.message || err);
            }
          } else {
            console.warn("(availabilityController.js) ⚠️ Skipping calendar invite — no email found for lead musician.");
          }
        } else {
          console.warn("(availabilityController.js) ⚠️ Skipping calendar invite — no musicianId on badge.");
        }
      } catch (err) {
        console.warn("(availabilityController.js) ⚠️ Calendar invite error:", err?.message || err);
      }
    }

    return { success: true, updated: true, badge };
  } catch (err) {
    console.error("❌ rebuildAndApplyAvailabilityBadge error:", err);
    return { success: false, message: err?.message || "Server error" };
  }
}