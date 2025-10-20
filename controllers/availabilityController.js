
import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { createCalendarInvite, updateCalendarEvent } from "../controllers/googleController.js";
import { sendSMSMessage, sendWhatsAppText } from "../utils/twilioClient.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { postcodes } from "../utils/postcodes.js"; // <-- ensure this path is correct in backend
import { computeMemberMessageFee } from "./helpersForCorrectFee.js";

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
  console.log(`🟢 (availabilityController.js) safeFirst START at ${new Date().toISOString()}`, {
    actId: req.query?.actId,
    dateISO: req.query?.dateISO, });
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




// Send the booking-request message to ALL performers in a lineup //whatsapp going to band working
export async function sendBookingRequestToLineup({ actId, lineupId, date, address }) {
   console.log(`🟢 (availabilityController.js) sendBookingRequestToLineup START at ${new Date().toISOString()}`, {
 });
  const act = await Act.findById(actId).lean();
  if (!act) { console.warn("sendBookingRequestToLineup: no act", actId); return { sent: 0 }; }

  const dateISO = new Date(date).toISOString().slice(0, 10);
  const formattedDate = formatWithOrdinal(date);
  const shortAddr = String(address || "")
    .split(",").slice(-2).join(",").replace(/,\s*UK$/i, "").trim();

  const allLineups = Array.isArray(act.lineups) ? act.lineups : [];
  const lineup = lineupId
    ? (allLineups.find(l =>
        String(l._id) === String(lineupId) || String(l.lineupId) === String(lineupId)
      ) || allLineups[0]) 
    : allLineups[0];

  const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
  const contentSid = process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID; // HXcd99249…

  let sent = 0;

  for (const m of members) {
    const role = String(m?.instrument || "").trim().toLowerCase();
    if (!role || role === "manager" || role === "admin") continue; // performers only

    // normalise phone → +44…
    let phone = String(m?.phoneNumber || m?.phone || "").replace(/\s+/g, "");
    if (!phone && (m?.musicianId || m?._id)) {
      try {
        const mus = await Musician.findById(m.musicianId || m._id).select("phone phoneNumber").lean();
        phone = String(mus?.phone || mus?.phoneNumber || "").replace(/\s+/g, "");
      } catch {}
    }
    if (!phone) continue;
    if (phone.startsWith("07")) phone = phone.replace(/^0/, "+44");
    else if (phone.startsWith("44")) phone = `+${phone}`;
    else if (!phone.startsWith("+")) phone = `+${phone}`;

    // fee = SAME logic as enquiry
    const finalFee = await _finalFeeForMember({
      act, lineup, members, member: m, address, dateISO
    });

    // Build SMS fallback using your enquiry copy builder (so WA+SMS match)
    const smsBody = buildAvailabilitySMS({
      firstName: m.firstName || m.name || "",
      formattedDate,
      formattedAddress: shortAddr,
      fee: String(finalFee),
      duties: m.instrument || "performance",
      actName: act.tscName || act.name || "the band",
    });

 // WhatsApp slots 1..6 ONLY – extra keys are NOT sent to Twilio
    const slots = {
      "1": m.firstName || m.name || "",
      "2": formattedDate,
      "3": shortAddr,
      "4": String(finalFee),
      "5": m.instrument || "performance",
      "6": act.tscName || act.name || "",
    };

    try {
      const waRes = await sendWhatsAppMessage({
        to: `whatsapp:${phone}`,
        contentSid,           // your instrumentalist booking-request template SID
        variables: slots,     // <-- pass numbered slots here
        smsBody,              // webhook can reuse this if WA undelivered
      });


      // Store the outbound SID so /twilio/status can match and send SMS on 63024 etc.
      await AvailabilityModel.findOneAndUpdate(
        { actId, dateISO, phone },
        {
          $setOnInsert: {
            enquiryId: Date.now().toString(),
            actId,
            lineupId: lineup?._id || lineup?.lineupId || null,
            phone,
            duties: m.instrument || "performance",
            fee: String(finalFee),
            formattedDate,
            formattedAddress: shortAddr,
            reply: null,
            createdAt: new Date(),
            actName: act.tscName || act.name || "",
            contactName: m.firstName || "",
            musicianName: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
            dateISO,
          },
          $set: {
            messageSidOut: waRes?.sid || null,
            contactChannel: "whatsapp",
            updatedAt: new Date(),
            "outbound.smsBody": smsBody,
            "outbound.sid": waRes?.sid || null,
          },
        },
        { upsert: true }
      );

      sent++;
      console.log("📣 Booking request sent", { to: phone, duties: m.instrument, fee: finalFee });
    } catch (e) {
      // WA failed immediately (e.g., bad variables) → send SMS now
      console.warn("⚠️ WA send failed, SMS fallback now", { to: phone, err: e?.message || e });
      try {
        await sendSMSMessage(phone, smsBody);
        sent++;
        console.log("✅ SMS sent (direct fallback)", { to: phone });
      } catch (smsErr) {
        console.warn("❌ SMS failed", { to: phone, err: smsErr?.message || smsErr });
      }
    }
  }

  return { sent, members: members.length };
}

// Resolve the musicianId who replied YES for a given act/date.
// Returns the most-recent YES row (if any).
export const resolveAvailableMusician = async (req, res) => {
   console.log(`🟢 (availabilityController.js) resolveAvailableMusician START at ${new Date().toISOString()}`, {
 });
  try {
    const { actId, dateISO } = req.query || {};
    if (!actId || !dateISO) {
      return res
        .status(400)
        .json({ success: false, musicianId: null, message: "Missing actId/dateISO" });
    }

    const row = await AvailabilityModel.findOne({ actId, dateISO, reply: "yes" })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select({ musicianId: 1 })
      .lean();

    return res.json({ success: true, musicianId: row?.musicianId || null });
  } catch (e) {
    console.error("resolveAvailableMusician error:", e?.message || e);
    return res
      .status(500)
      .json({ success: false, musicianId: null, message: e?.message || "Server error" });
  }
};

// ---- Allocation sync with Booking Board ----
async function refreshAllocationForActDate(actId, dateISO) {
   console.log(`🟢 (availabilityController.js) refreshAllocationForActDate START at ${new Date().toISOString()}`, {
 });
  try {
    if (!actId || !dateISO) return;

    const [yesCount, pendingCount, noCount] = await Promise.all([
      AvailabilityModel.countDocuments({ actId, dateISO, reply: "yes" }),
      AvailabilityModel.countDocuments({ actId, dateISO, reply: null }),
      AvailabilityModel.countDocuments({ actId, dateISO, reply: { $in: ["no", "unavailable"] } }),
    ]);

    let status = "in_progress";
    if (yesCount >= 1 && pendingCount === 0) status = "fully_allocated";
    if (noCount > 0 && yesCount === 0) status = "gap";

    await BookingBoardItem.updateMany(
      { actId, eventDateISO: dateISO },
      { $set: { allocation: { status, lastCheckedAt: new Date() } } }
    );
  } catch (e) {
    console.warn("⚠️ refreshAllocationForActDate failed:", e?.message || e);
  }
}
// one-shot WA→SMS for a single deputy
const notifyDeputyOneShot = async ({
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
   console.log(`🟢 (availabilityController.js) notifyDeputyOneshot START at ${new Date().toISOString()}`, {
 });
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
    const phoneRaw   = deputy?.phoneNumber || deputy?.phone || "";
    const phoneE164  = toE164(phoneRaw);          // +44…
    const phoneWA    = toWA(phoneRaw);            // whatsapp:+44…
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

        // (not used for booking confirmations)

    const smsBody =
      `Hi 9 ${templateParams.FirstName}, you've received an enquiry for a gig on ` +
      `${templateParams.FormattedDate} in ${templateParams.FormattedAddress} ` +
      `at a rate of £${templateParams.Fee} for ${templateParams.Duties} duties with ` +
      `${templateParams.ActName}. Please indicate your availability 💫 Reply YES / NO.`;

    // WA first (Twilio will trigger webhook on undelivered → SMS fallback)
    console.log("📤 Sending (WA → SMS fallback) to deputy…", {
      phoneMasked: maskPhone(phoneE164),
    });
    const sendRes = await sendWhatsAppMessage({
      to: phoneWA,            // pass the whatsapp:+ prefix explicitly
      templateParams,
      smsBody,                // stash this in DB so webhook can reuse verbatim
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
          "outbound.smsBody": smsBody,
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
      smsBody, // store exactly what we intend to use on fallback
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
// --- New helpers for badge rebuilding ---
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
  });

return { vocalist, phone };}

// handle status callback from Twilio
// ✅ Handle Twilio Status Callback (WhatsApp delivery)
  export const twilioStatusHandler = async (req, res) => {
    console.log(`🐠 (controllers/shortlistController.js) twilioStatusHandler called at`, new Date().toISOString(), {
    body: req.body,
  });
    try {
      const { MessageSid: sid, MessageStatus: status, ErrorCode: err, To: to } = req.body;
      console.log("📡 Twilio status callback:", { sid, status, err, to });

      // Only act if WA failed (undelivered or invalid destination)
      const failed = status === "undelivered" && (err === "63024" || err === "63016");
      if (!failed) return res.status(200).send("OK");

      // Try find the availability record
      let availability = await Availability.findOne({ "outbound.sid": sid }).lean();

      // Fallback: match by phone if SID wasn’t yet written
      if (!availability && to) {
        const normalized = String(to).replace(/^whatsapp:/i, "");
        availability = await Availability.findOne({ phone: normalized }).sort({ createdAt: -1 }).lean();
      }

      if (!availability) {
        console.warn("⚠️ No matching availability found for sid or phone:", sid, to);
        return res.status(200).send("OK");
      }

      // Rebuild SMS body
      const act = await Act.findById(availability.actId).lean();
      console.log("🧭 County travel debug:", {
    county: availability.county || "none",
    useCountyTravelFee: act.useCountyTravelFee,
    countyFees: act.countyFees,
    costPerMile: act.costPerMile,
    useMURates: act.useMURates,
  });

  let travel = 0;

  if (act.useCountyTravelFee && act.countyFees) {
    const countyName = availability.county || ""; // 🌍 stored when derived
    travel = Number(act.countyFees[countyName]) || 0;
    console.log("🏞️ County-based travel:", { countyName, travel });
  } else if (act.costPerMile) {
    console.log("🛣️ costPerMile travel calculation not implemented here");
  } else if (act.useMURates) {
    console.log("🎼 MU rate fallback active");
  }
  // countyFees or costPerMile or MU rates
  if (act.useCountyTravelFee && act.countyFees) {
    const countyMatch = Object.entries(act.countyFees).find(([county]) =>
      availability.formattedAddress?.includes(county)
    );
    if (countyMatch) travel = Number(countyMatch[1]) || 0;
  } else if (act.costPerMile && member.postcode) {
    // (you can later reuse your DistanceCache function for this)
    travel = 0; // stub until DistanceCache integrated
  }

  // 🔧 Build SMS with correct data
  const smsBody = await buildAvailabilitySMS({
    firstName: member.firstName || availability.contactName || availability.firstName,
    formattedDate: availability.dateISO,
    formattedAddress: availability.formattedAddress,
    act,
    member,
    travelOverride: travel,                        // ✅ use the travel you computed
    dutiesOverride: member.instrument,
    actNameOverride: act?.tscName,
    countyName: availability.county,               // may be 'Berkshire'
  });

      // Send fallback SMS
      await sendSMSMessage(to, smsBody);
      console.log(`📩 SMS fallback sent to ${to}`, { sid });
    } catch (err) {
      console.error("❌ Error in Twilio status handler:", err.message);
    }

    res.status(200).send("OK");
  };

// ✅ main function
export const shortlistActAndTriggerAvailability = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) shortlistActAndTriggerAvailability called at`, new Date().toISOString(), {
  body: req.body,
});
  console.log("🎯 [START] shortlistActAndTriggerAvailability");
  try {
    const { userId, actId, selectedDate, selectedAddress, lineupId } = req.body;
    console.log("📦 Incoming body:", { userId, actId, selectedDate, selectedAddress, lineupId });

    if (!userId || !actId) {
      return res.status(400).json({ success: false, message: "Missing userId or actId" });
    }

    const outcode = extractOutcode(selectedAddress);
    const resolvedCounty = countyFromOutcode(outcode);
    console.log("🌍 Derived county:", resolvedCounty || "❌ none");

    // 🗂️ Find or create shortlist
    let shortlist = await Shortlist.findOne({ userId });
    if (!shortlist) shortlist = await Shortlist.create({ userId, acts: [] });
    if (!Array.isArray(shortlist.acts)) shortlist.acts = [];

    const existingEntry = shortlist.acts.find((entry) => {
      const sameAct = String(entry.actId) === String(actId);
      const sameDate = entry.dateISO === selectedDate;
      const sameAddr =
        (entry.formattedAddress || "").trim().toLowerCase() ===
        (selectedAddress || "").trim().toLowerCase();
      return sameAct && sameDate && sameAddr;
    });

    const alreadyShortlisted = !!existingEntry;

    if (alreadyShortlisted) {
      shortlist.acts = shortlist.acts.filter((entry) => {
        const sameAct = String(entry.actId) === String(actId);
        const sameDate = entry.dateISO === selectedDate;
        const sameAddr =
          (entry.formattedAddress || "").trim().toLowerCase() ===
          (selectedAddress || "").trim().toLowerCase();
        return !(sameAct && sameDate && sameAddr);
      });
      console.log("❌ Removed specific act/date/address triple");
    } else {
      shortlist.acts.push({ actId, dateISO: selectedDate, formattedAddress: selectedAddress });
      console.log("✅ Added new act/date/address triple");
    }

    await shortlist.save();

    // ✅ Only send WhatsApp if newly added
    if (!alreadyShortlisted && selectedDate && selectedAddress) {
      const actData = await Act.findById(actId).lean();
      if (!actData) throw new Error("Act not found");

      const lineup = lineupId
        ? actData.lineups?.find((l) => String(l._id) === String(lineupId))
        : actData.lineups?.[0];
      if (!lineup) throw new Error("No lineup found");

      const { vocalist, phone } = findVocalistPhone(actData, lineupId) || {};
      if (!phone || !vocalist) throw new Error("No valid phone for vocalist");

      console.log("✅ Vocalist identified:", {
        name: `${vocalist.firstName} ${vocalist.lastName}`,
        phone,
        act: actData.tscName,
        lineup: lineup.actSize,
      });

      // 🛡️ Guard: prevent duplicate WA sends
      const existingAvailability = await Availability.findOne({
        actId,
        lineupId: lineup._id,
        musicianId: vocalist._id,
        dateISO: selectedDate,
      }).sort({ createdAt: -1 });

      if (existingAvailability && !["no", "unavailable"].includes(existingAvailability.reply)) {
        const status = existingAvailability.status || "sent";
        console.log(
          `🛑 Skipping duplicate WA send — existing record found (status=${status}, reply=${existingAvailability.reply})`
        );
        return res.json({
          success: true,
          message: "Already sent availability request",
          shortlisted: true,
        });
      }

      // 🧾 Compute fee + build message variables
      const shortAddress =
        selectedAddress?.split(",")?.slice(-2)?.join(" ")?.trim() || selectedAddress || "";
      const fee = await computeMemberMessageFee({
        act: actData,
        lineup,
        member: vocalist,
        address: selectedAddress,
        dateISO: selectedDate,
      });

const normalizeTscName = (name = "") =>
  name.toLowerCase().replace(/\s+/g, "").replace(/[^\w]/g, "");

const msgVars = {
  1: vocalist.firstName || "",
  2: new Date(selectedDate).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
  3: shortAddress,
  4: fee.toString(),
  5: vocalist.instrument || "",
  6: actData.tscName || "",
  7: normalizeTscName(actData.tscName), // ✅ Twilio buttons now get YESfunkroyale
};

console.log("📨 Twilio msgVars preview:", msgVars);


      const smsBody = await buildAvailabilitySMS({
        firstName: msgVars[1],
        formattedDate: msgVars[2],
        formattedAddress: msgVars[3],
        act: actData,
        member: vocalist,
        feeOverride: msgVars[4],
        dutiesOverride: msgVars[5],
        actNameOverride: msgVars[6],
        countyName: resolvedCounty,
      });

      // 🧾 Create availability record before WA send
      const availability = await Availability.create({
        actId,
        lineupId: lineup._id,
        musicianId: vocalist._id,
        phone,
        dateISO: selectedDate,
        formattedAddress: selectedAddress,
        county: resolvedCounty,
        formattedDate: new Date(selectedDate).toLocaleDateString("en-GB"),
        duties: vocalist.instrument,
        reply: null,
        status: "queued",
        outbound: { sid: null, smsBody },
      });

      try {
   // ✅ Send WhatsApp message
const safeTsc = actData.tscName
  ?.toLowerCase()
  ?.replace(/\s+/g, "_")
  ?.replace(/[^\w\-]/g, ""); // remove special chars
const payload = `YES_${safeTsc}`;


const waMsg = await client.messages.create({
  from: `whatsapp:${process.env.TWILIO_WA_SENDER}`,
  to: `whatsapp:${phone}`,
  contentSid: process.env.TWILIO_ENQUIRY_SID,
  contentVariables: JSON.stringify(msgVars),
});

        console.log(`✅ WhatsApp enquiry sent to ${vocalist.firstName} (${phone}), sid=${waMsg.sid}`);

        await Availability.updateOne(
          { _id: availability._id },
          { $set: { "outbound.sid": waMsg.sid, status: "sent" } }
        );
      } catch (err) {
        // --- WhatsApp undeliverable fallback ---
        if (err.code === 63024 || err.code === 63016) {
          console.warn(`⚠️ WhatsApp undeliverable (${err.code}) for ${phone}. Sending SMS fallback...`);
          await sendSMSMessage(phone, smsBody);
          console.log(`📩 SMS fallback sent to ${phone}`);
          await Availability.updateOne(
            { _id: availability._id },
            { $set: { status: "sms_sent" } }
          );
        } else {
          console.error("❌ WhatsApp send error:", err.message);
          throw err;
        }
      }
    }

    res.json({
      success: true,
      message: alreadyShortlisted
        ? "Removed from shortlist"
        : "Added and message sent",
      shortlisted: !alreadyShortlisted,
    });
  } catch (err) {
    console.error("❌ shortlistActAndTriggerAvailability error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};(full) {
  if (!full) return "";
  const parts = full.split(",").map((p) => p.trim());
  const lastTwo = parts.slice(-2).join(" ");
  return lastTwo;
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
export const triggerAvailabilityRequest = async (req, res) => {
   console.log(`🟢 (availabilityController.js) triggerAvailabilityRequest START at ${new Date().toISOString()}`, {
 });
  try {
    console.log("🛎 triggerAvailabilityRequest", req.body);

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
  formattedAddress: new RegExp(shortAddress, "i"), // case-insensitive partial match
}).lean();

if (existingEnquiry) {
  console.log("⛔ Availability already triggered for this act/date/address — skipping send");

};

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

    // role helper
    const isVocalRole = (role = "") => {
      const r = String(role).toLowerCase();
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

    // phone normaliser (E.164-ish)
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

    const repliedYes = new Map();   // phone -> row
    const repliedNo  = new Map();   // phone -> row
    const pending    = new Map();   // phone -> row

    for (const r of prevRows) {
      const p = toE164(r.phone);
      if (!p) continue;
      const rep = String(r.reply || "").toLowerCase();
      if (rep === "yes") {
        repliedYes.set(p, r);
      } else if (rep === "no" || rep === "unavailable") {
        repliedNo.set(p, r);
      } else {
        // no reply yet
        const existing = pending.get(p);
        // keep the most recent row
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
    // 2) vocal leads only
    const vocalLeads = members.filter((m) => isVocalRole(m.instrument));
    if (!vocalLeads.length) {
      return res.json({
        success: true,
        message: "No vocalists found to notify",
      });
    }

    // 3) fee helper
    const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
    const membersCount = Math.max(1, members.length || 1);
    const perHead = lineupTotal > 0 ? lineupTotal / membersCount : 0;

 // Inside triggerAvailabilityRequest, near your existing feeForMember()
const feeForMember = async (member) => {
  const baseFee = Number(member?.fee ?? 0);
  const perHead = (() => {
    const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
    const membersCount = Math.max(1, (Array.isArray(members) ? members.length : 0) || 1);
    return lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
  })();

  // Pick a base: explicit member.fee wins; else per-head (ceil)
  const base = baseFee > 0 ? baseFee : perHead;

const { outcode, county: selectedCounty } = countyFromAddress(address);
  const selectedDate = dateISO;

let travelFee = 0;
let usedCountyRate = false;
let countyRateValue = 0;

if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
  const raw = getCountyFeeValue(act.countyFees, selectedCounty);
  const val = Number(raw);
  if (Number.isFinite(val) && val > 0) {
    usedCountyRate = true;
    countyRateValue = Math.ceil(val);
    travelFee = countyRateValue; // per-member, overrides distance calc
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

    // Otherwise fall back to your distance-based compute
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

  const final = Math.max(0, Math.ceil(Number(base || 0) + Number(travelFee || 0)));


  return final;
};

    // 4) decide who to ping
    let sentCount = 0;

 for (const lead of vocalLeads) {
  const phone = normalizePhone(lead?.phoneNumber || lead?.phone || "");
  const finalFee = await feeForMember(lead);



  // If lead already said NO/UNAVAILABLE → go straight to deputies
  if (negatives.has(phone)) {
    // ... (your existing deputies block stays as-is)
    // continue to next lead after deputies logic
    // continue;
  }

  // Lead not known-unavailable:
  if (!phone) {
    console.warn("⚠️ Lead has no usable phone, skipping.");
    continue;
  }

  // ⏸️ Per-phone queue: if this singer already has a pending enquiry in last 3h, defer this one
const THREE_HOURS = 3 * 60 * 60 * 1000;
// Scope to this actId + dateISO so a different date isn't blocked
const recentPending = await AvailabilityModel.findOne({
  actId,
  dateISO,
  phone,
  reply: null,
  updatedAt: { $gte: new Date(Date.now() - THREE_HOURS) },
}).lean();

  if (recentPending) {
    await DeferredAvailability.create({
      phone,
      actId: act._id,
      dateISO,
      duties: lead.instrument || "Lead Vocal",
      fee: String(finalFee),
      formattedDate,
      formattedAddress: shortAddress,
      payload: {
        to: phone,
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
        smsBody:     // (not used for booking confirmations )

          `Hi 8${firstNameOf(lead)}, you've received an enquiry for a gig on ` +
          `${formattedDate} in ${shortAddress} at a rate of £${String(finalFee)} for ` +
          `${lead.instrument} duties with ${act.tscName}. Please reply YES / NO.`,
      },
    });

    console.log("⏸️ Deferred enquiry due to active pending for this phone.");
    continue; // don't send now; next lead
  }

  // Create availability stub for lead (idempotent on actId+dateISO+phone)
const enquiryId = Date.now().toString();
const now = new Date();

const availabilityDoc = await AvailabilityModel.findOneAndUpdate(
  { actId: act._id, dateISO, phone },
  {
    $setOnInsert: {
      enquiryId,
      actId: act._id,
      lineupId: lineup?._id || lineup?.lineupId || null,
      musicianId: lead?.musicianId || lead?._id || null,
      phone,
      duties: lead.instrument || "Lead Vocal",
      formattedDate,
      formattedAddress: shortAddress,
      fee: String(finalFee),
      reply: null,
      inbound: {},
      dateISO,
      createdAt: now,
      actName: act.tscName || act.name || "",
      musicianName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
      contactName: firstNameOf(lead),
    },
    $set: { updatedAt: now },
  },
  { upsert: true, new: true }
);

// Cool-down checks (MUST run after availabilityDoc exists)
const TWO_MIN = 2 * 60 * 1000;
const last = new Date(availabilityDoc?.updatedAt || 0).getTime();
const force = String(req.query?.force || req.body?.force || "") === "1";

if (!force && availabilityDoc?.messageSidOut) {
  if (Date.now() - last < 5 * 1000) {
    console.log("🛑 Skipping duplicate send (cool-down):", {
      phone,
      actId: String(act._id),
      dateISO,
    });
    continue;
  }
  if (Date.now() - last < TWO_MIN) {
    console.log("🛑 Skipping re-send within 2 min window:", {
      phone,
      actId: String(act._id),
      dateISO,
    });
    continue;
  }
}

// --- Build unified copy for both WA + SMS ---
const smsBody = buildAvailabilitySMS({
  firstName: firstNameOf(lead),
  formattedDate,
  formattedAddress: shortAddress,
  fee: String(finalFee),
  duties: lead.instrument || "your role",
  actName: act.tscName || act.name || "the act",
});

// Use the enquiry template SID you already created
const contentSid = process.env.TWILIO_ENQUIRY_SID;

// WhatsApp template variables: numbered 1-6
const variables = {
  "1": firstNameOf(lead),
  "2": formattedDate,
  "3": shortAddress,
  "4": String(finalFee),
  "5": lead.instrument || "performance",
  "6": act.tscName || act.name || "the band",
};

let sendRes = null;
try {
  // 🟢 (availabilityController.js) Try WhatsApp first
  sendRes = await sendWhatsAppMessage({
    to: `whatsapp:${phone}`,
    contentSid,
    variables,
    smsBody, // stored for webhook SMS fallback
  });

  console.log("📣 Availability request (WA) sent", {
    to: phone,
    duties: lead.instrument,
    fee: finalFee,
    sid: sendRes?.sid,
  });
} catch (waErr) {
  console.warn("⚠️ WA send failed — trying SMS fallback", {
    to: phone,
    err: waErr?.message || waErr,
  });

  // 🧠 SMS cooldown rule: only one pending SMS per musician
  const pendingSMS = await AvailabilityModel.findOne({
    phone,
    contactChannel: "sms",
    reply: null,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // within 24h
  }).lean();

  if (pendingSMS) {
    console.log("⏸️ Skipping SMS — awaiting reply from earlier enquiry:", {
      phone,
      lastSent: pendingSMS.createdAt,
    });
    sendRes = { channel: "sms", status: "skipped_pending" };
  } else {
    try {
      await sendSMSMessage(phone, smsBody);
      sendRes = { channel: "sms", status: "sent" };
      console.log("✅ SMS fallback sent", { to: phone });
    } catch (smsErr) {
      console.warn("❌ SMS fallback also failed", {
        to: phone,
        err: smsErr?.message || smsErr,
      });
      sendRes = { channel: "none", status: "failed" };
    }
  }
}

// Update DB so webhook / dashboards stay in sync
await AvailabilityModel.updateOne(
  { _id: availabilityDoc._id },
  {
    $set: {
      status: sendRes?.status || "queued",
      messageSidOut: sendRes?.sid || null,
      contactChannel: sendRes?.channel || "whatsapp",
      actName: act.tscName || act.name || "",
      musicianName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
      contactName: firstNameOf(lead),
      duties: lead.instrument || "Lead Vocal",
      fee: String(finalFee),
      formattedDate,
      formattedAddress: shortAddress,
      updatedAt: new Date(),
    },
  }
);

await EnquiryMessage.create({
  enquiryId,
  actId: act._id,
  lineupId: lineup?._id || lineup?.lineupId || null,
  musicianId: lead._id || null,
  phone,
  duties: lead.instrument || "Lead Vocal",
  fee: String(finalFee),
  formattedDate,
  formattedAddress: shortAddress,
  messageSid: sendRes?.sid || null,
  status: mapTwilioToEnquiryStatus(sendRes?.status),
  meta: {
    actName: act.tscName || act.name,
    selectedCounty,
    isNorthernGig: false,
    MetaActId: String(act._id || ""),
    MetaISODate: dateISO,
    MetaAddress: shortAddress,
  },
});

  await AvailabilityModel.updateOne(
    { _id: availabilityDoc._id },
    {
      $set: {
        status: sendRes?.status || "queued",
        messageSidOut: sendRes?.sid || null,
        contactChannel: sendRes?.channel || "whatsapp",
        actName: act.tscName || act.name || "",
        musicianName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
        contactName: firstNameOf(lead),
        duties: lead.instrument || "Lead Vocal",
        fee: String(finalFee),
        formattedDate,
        formattedAddress: shortAddress,
        updatedAt: new Date(),
      },
    }
  );

  await EnquiryMessage.create({
    enquiryId,
    actId: act._id,
    lineupId: lineup?._id || lineup?.lineupId || null,
    musicianId: lead._id || null,
    phone,
    duties: lead.instrument || "Lead Vocal",
    fee: String(finalFee),
    formattedDate,
    formattedAddress: shortAddress,
    messageSid: sendRes?.sid || null,
    status: mapTwilioToEnquiryStatus(sendRes?.status),
    meta: {
      actName: act.tscName || act.name,
selectedCounty,
      isNorthernGig: false,
      MetaActId: String(act._id || ""),
      MetaISODate: dateISO,
      MetaAddress: shortAddress,
    },
  });

  console.log("✅ Lead pinged:", {
    name: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
    phone,
    channel: sendRes?.channel,
    enquiryId,
  });
  alreadyPingedSet.add(phone);
  sentCount++;
}



    return res.json({
      success: true,
      sent: sentCount,
      note:
        sentCount === 0
          ? "No one pinged (all leads unavailable and no deputy found)."
          : undefined,
    });
  } catch (err) {
    console.error("triggerAvailabilityRequest error:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
};
async function getDeputyDisplayBits(dep) {
   console.log(`🟢 (availabilityController.js) getDeputyDisplayBits START at ${new Date().toISOString()}`, {
 });
  // Return { musicianId, photoUrl, profileUrl }
  const PUBLIC_SITE_BASE = (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");
  try {
    // Prefer an explicit musicianId if present, else fall back to embedded _id
    const musicianId = (dep?.musicianId && String(dep.musicianId)) || (dep?._id && String(dep._id)) || "";

    // 1) Try to read an image directly from dep (handles both string or {url} shapes)
    let photoUrl = getPictureUrlFrom(dep);

    // 2) If none on the deputy, try by musicianId (strongest lookup)
    let mus = null;
    if (!photoUrl && musicianId) {
      mus = await Musician.findById(musicianId)
        .select("musicianProfileImageUpload musicianProfileImage profileImage profilePicture.url photoUrl imageUrl email")
        .lean();
      photoUrl = getPictureUrlFrom(mus || {});
    }

    // 3) If still none, try by email on the deputy or by the musician doc’s email (but DO NOT use phone to avoid collisions)
    if (!photoUrl) {
      const email = dep?.email || dep?.emailAddress || mus?.email || "";
      if (email) {
        const musByEmail = await Musician.findOne({ email })
          .select("musicianProfileImageUpload musicianProfileImage profileImage profilePicture.url photoUrl imageUrl _id")
          .lean();
        if (musByEmail) {
          photoUrl = getPictureUrlFrom(musByEmail);
          // If we didn't have a musicianId, populate it now
          if (!musicianId && musByEmail._id) {
            dep.musicianId = musByEmail._id; // non-persistent; used by caller for profile link
          }
        }
      }
    }

    const resolvedMusicianId = (dep?.musicianId && String(dep.musicianId)) || musicianId || "";
    const profileUrl = resolvedMusicianId ? `${PUBLIC_SITE_BASE}/musician/${resolvedMusicianId}` : "";

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


// Build an availability badge state from Availability rows for a given act/date
async function buildavailabilityBadgesFromRows(act, dateISO) {
   console.log(`🟢 (availabilityController.js) buildavailabilityBadgesFromRows START at ${new Date().toISOString()}`, {
 });
  if (!act || !dateISO) return null;
  const rows = await AvailabilityModel.find({ actId: act._id, dateISO })
    .select({ phone: 1, reply: 1, musicianId: 1, updatedAt: 1 })
    .lean();

  // Phone -> reply map
  const replyByPhone = new Map();
  for (const r of rows) {
    const p = normalizePhoneE164(r.phone);
    if (!p) continue;
    const rep = String(r.reply || "").toLowerCase();
    // Prefer a definitive YES/NO over null pending; if multiple, keep most recent
    const prev = replyByPhone.get(p);
    const ts = new Date(r.updatedAt || 0).getTime();
    if (!prev || ts > prev.ts) replyByPhone.set(p, { reply: rep || null, ts });
  }

  // Iterate lineups → lead vocal members; if a lead is NO, try their deputies
  const allLineups = Array.isArray(act.lineups) ? act.lineups : [];
  for (const l of allLineups) {
    const members = Array.isArray(l.bandMembers) ? l.bandMembers : [];
    for (const m of members) {
      if (!isVocalRoleGlobal(m.instrument)) continue;
      const leadPhone = normalizePhoneE164(m.phoneNumber || m.phone || "");
      const leadReply = leadPhone ? (replyByPhone.get(leadPhone)?.reply || null) : null;

      // If lead is a NO/UNAVAILABLE: try up to 3 deputies that are YES
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
        if (yesDeps.length) {
          // Build deputies payload for badge
          const enriched = [];
          for (const d of yesDeps) {
            const bits = await getDeputyDisplayBits(d);
            enriched.push({
              name: `${d.firstName || ""} ${d.lastName || ""}`.trim(),
              musicianId: bits.musicianId || "",
              photoUrl: bits.photoUrl || "",
              profileUrl: bits.profileUrl || "",
              setAt: new Date(),
            });
          }
          return {
            active: true,
            dateISO,
            isDeputy: true,
            inPromo: false,
            deputies: enriched,
            vocalistName: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
            address: act?.availabilityBadges?.address || "",
            setAt: new Date(),
          };
        }
      }

      // If the lead themselves said YES, build a single-person badge
      if (leadReply === "yes") {
        const bits = await getDeputyDisplayBits(m);
        return {
          active: true,
          dateISO,
          isDeputy: false,
          inPromo: !!m.inPromo,
          vocalistName: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          musicianId: bits.musicianId || "",
          photoUrl: bits.photoUrl || "",
          address: act?.availabilityBadges?.address || "",
          setAt: new Date(),
        };
      }
      // After you apply the badge on the Act (inside reply === "yes")
try {
  await sendClientEmail({
    actId: updated.actId,
    subject: `Good news — ${act?.tscName || act?.name || "The band"} lead vocalist is available`,
    html: `<p>${(updated?.musicianName || "").trim() || "Lead vocalist"} is free for ${updated.formattedDate} (${updated.formattedAddress}).</p>`
  });
} catch (e) {
  console.warn("⚠️ sendClientEmail lead-YES failed:", e?.message || e);
}
    }
  }
  return null;
}

/**
 * After a LEAD replies "no/unavailable", keep up to 3 active deputies for the same act/date.
 * - Re-ping stale pending deputies (> 6h since last send)
 * - Skip deputies who already replied NO/UNAVAILABLE
 * - Top up with fresh deputies until we have 3 active (YES + pending)
 *
 * @param {Object} params
 * @param {Object} params.act            // Act doc (lean)
 * @param {Object} params.updated        // Availability row we just updated from inbound
 *   expected fields on `updated`:
 *     - actId, lineupId, phone, dateISO, formattedDate, formattedAddress, duties, fee
 * @param {string} [params.fromRaw]      // Raw "From" phone (optional)
 */
export async function handleLeadNegativeReply({ act, updated, fromRaw = "" }) {
   console.log(`🟢 (availabilityController.js) handleLeadNegativeReply START at ${new Date().toISOString()}`, {
 });
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
// availabilityController.js (helpers)
export async function rebuildAndApplyBadge(actId, dateISO) {
   console.log(`🟢 (availabilityController.js) rebuildAndApplyBadge START at ${new Date().toISOString()}`, {
 });
  try {
    if (!actId || !dateISO) return;

    const act = await Act.findById(actId).lean();
    if (!act) return;

    const badge = await buildavailabilityBadgesFromRows(act, dateISO);

    // --- NEW: Aggregate deputy replies (up to 3) ---
    const deputies = await AvailabilityModel.find({
      actId,
      dateISO,
      reply: "yes",
      isDeputy: true,
    })
      .sort({ repliedAt: 1 })
      .limit(3)
      .lean();

    const deputyBadges = deputies.map((dep) => ({
      musicianId: dep.musicianId?.toString?.() || "",
      photoUrl:
        dep.photoUrl ||
        dep.profilePicture ||
        dep.musician?.profilePicture ||
        "",
      profilePicture: dep.profilePicture || "",
      profileUrl: dep.musicianId
        ? `${process.env.FRONTEND_URL || process.env.PUBLIC_SITE_BASE}/musician/${dep.musicianId}`
        : "",
      setAt: dep.updatedAt || new Date(),
    }));

    // --- Combine lead + deputy badges ---
    if (badge || deputyBadges.length > 0) {
      const combined = {
        ...(act.availabilityBadges || {}),
        ...(badge || {}),
        deputies: deputyBadges,
      };

      await Act.updateOne(
        { _id: act._id },
        { $set: { availabilityBadges: combined } }
      );

      console.log(
        `✅ Applied badge for ${act.tscName || act.name}: lead=${
          badge?.active ? "active" : "none"
        }, deputies=${deputyBadges.length}`
      );
    } else {
      // No lead and no deputies → clear badge
      await Act.updateOne(
        { _id: act._id },
        {
          $set: { "availabilityBadges.active": false },
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

      console.log(`🧹 Cleared badge for ${act.tscName || act.name}`);
    }
  } catch (e) {
    console.warn("⚠️ rebuildAndApplyBadge failed:", e?.message || e);
  }
}
export const rebuildavailabilityBadges = async (req, res) => {
  console.log(`🟢 (availabilityController.js) rebuildavailabilityBadges START at ${new Date().toISOString()}`);
  try {
    const { actId, dateISO } = req.body || {};
    if (!actId || !dateISO)
      return res.status(400).json({ success: false, message: "Missing actId/dateISO" });

    // Load act
    const act = await Act.findById(actId).lean();
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    console.log(`🎯 Rebuilding availability badge for Act=${act.tscName || act.name} @ ${dateISO}`);

    // Get availability replies
    const availRows = await AvailabilityModel.find({
      actId,
      dateISO,
      reply: { $in: ["yes", "no", "unavailable"] },
    }).lean();

    if (!availRows.length) {
      await Act.updateOne(
        { _id: actId },
        { $set: { "availabilityBadges.active": false }, $unset: { "availabilityBadges.deputies": "" } }
      );
      return res.json({ success: true, updated: false, reason: "No replies found" });
    }

    // Filter only YES replies
    const yesReplies = availRows.filter(r => r.reply === "yes");
    if (!yesReplies.length) {
      await Act.updateOne(
        { _id: actId },
        { $set: { "availabilityBadges.active": false }, $unset: { "availabilityBadges.deputies": "" } }
      );
      console.log("⚠️ No YES replies — badge cleared.");
      return res.json({ success: true, updated: false, reason: "No YES replies" });
    }

    // Helper to enrich musician info
    const getMusicianFromReply = async (replyRow) => {
      if (!replyRow) return null;
      const phone = replyRow.phone || replyRow.availabilityPhone;
      if (!phone) return null;

      // Find in act first
      let found = await findPersonByPhone(act, replyRow.lineupId, phone);
      let person = found?.person || null;

      const hasPhoto =
        person?.profilePicture?.url ||
        person?.profilePicture ||
        person?.photoUrl ||
        person?.imageUrl ||
        (Array.isArray(person?.images) && person.images.length > 0);

      // Fallback to Musician DB
      if (!person || !hasPhoto) {
        const musicianDoc = await Musician.findOne({
          $or: [{ phoneNormalized: phone }, { phone }, { phoneNumber: phone }],
        })
          .select("firstName lastName email profilePicture coverHeroImage digitalWardrobeBlackTie digitalWardrobeFormal digitalWardrobeSmartCasual additionalImages")
          .lean();

        if (musicianDoc) {
          person = musicianDoc;
          const possiblePhotos = [
            musicianDoc.profilePicture,
            musicianDoc.coverHeroImage,
            musicianDoc.digitalWardrobeBlackTie?.[0],
            musicianDoc.digitalWardrobeFormal?.[0],
            musicianDoc.digitalWardrobeSmartCasual?.[0],
            musicianDoc.additionalImages?.[0],
          ].filter(Boolean);

          if (possiblePhotos.length) {
            person.profilePicture = possiblePhotos[0];
          }
        }
      }

      const name =
        (person?.firstName && person?.lastName
          ? `${person.firstName} ${person.lastName}`
          : replyRow.musicianName || "(unknown)").trim();

      const photoUrl =
        person?.profilePicture?.url ||
        person?.profilePicture ||
        person?.photoUrl ||
        person?.imageUrl ||
        (Array.isArray(person?.images) && person.images[0]?.url) ||
        "";

      const email =
        person?.email ||
        person?.emailAddress ||
        (Array.isArray(person?.emails) && person.emails[0]) ||
        null;

      return { person, name, photoUrl, email };
    };

    // Build badge
    const lead = yesReplies[0];
    const deputies = yesReplies.slice(1, 4);
    const leadData = await getMusicianFromReply(lead);

    const rebuiltBadge = {
      active: true,
      dateISO,
      isDeputy: false,
      vocalistName: leadData?.name || "(unknown)",
      musicianId: leadData?.person?._id || null,
      photoUrl: leadData?.photoUrl || "",
      profileUrl: leadData?.person?._id ? `/musician/${leadData.person._id}` : "",
      setAt: lead.repliedAt || new Date(),
      deputies: [],
    };

    for (const dep of deputies) {
      const depData = await getMusicianFromReply(dep);
      if (depData) {
        rebuiltBadge.deputies.push({
          musicianId: depData.person?._id || null,
          vocalistName: depData.name,
          photoUrl: depData.photoUrl,
          profileUrl: depData.person?._id ? `/musician/${depData.person._id}` : "",
          setAt: dep.repliedAt || new Date(),
        });
      }
    }

    rebuiltBadge.deputies = rebuiltBadge.deputies.slice(0, 3);

    // ✅ Save badge safely (fix CastError)
    await Act.updateOne(
      { _id: actId },
      {
        $set: {
          [`availabilityBadges.${dateISO}`]: rebuiltBadge,
        },
      }
    );

    console.log("✅ Applied availability badge:", {
      actId,
      dateISO,
      vocalist: rebuiltBadge.vocalistName,
      deputies: rebuiltBadge.deputies.length,
    });
try {
  if (leadData?.email) {
    console.log("📅 Sending Google Calendar invite to:", leadData.email);

    await createCalendarInvite({
      actId,
      dateISO,
      email: leadData.email,
      summary: `TSC Enquiry: ${act.tscName || act.name}`,
description: `You have confirmed availability for performing with ${
  act.tscName || act.name
} on ${dateISO} in ${lead.formattedAddress || "the event area"} at a rate of £${lead?.fee || "TBC"}.\n\nIf you become unavailable, please inform us by declining the calendar invite.\n\nThank you!`,      startTime: new Date(`${dateISO}T17:00:00Z`),
      endTime: new Date(`${dateISO}T23:00:00Z`),
      address: act?.eventLocation || "TBC",
    });

    console.log("✅ Calendar invite sent successfully.");
  } else {
    console.warn("⚠️ Skipping calendar invite — no email found for lead musician.");
  }
} catch (e) {
  console.error("❌ Calendar invite creation failed:", e.message);
}
    // 📧 Send client notification email
    try {
      await sendClientEmail({
        actId,
        subject: `Good news — ${act?.tscName || act?.name || "The band"} lead vocalist is available`,
        html: `<p>${(leadData?.name || "Lead vocalist")} is free for ${dateISO}.</p>`,
      });
      console.log("📧 Client email sent for lead YES.");
    } catch (e) {
      console.warn("⚠️ sendClientEmail failed:", e.message);
    }

    return res.json({ success: true, updated: true, badge: rebuiltBadge });
  } catch (err) {
    console.error("❌ rebuildavailabilityBadges error:", err);
    return res.status(500).json({ success: false, message: err?.message || "Server error" });
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

    if (!updated) {
      console.warn("⚠️ No Availability row matched this WhatsApp reply.");
      return res.status(200).send("<Response/>");
    }

    console.log("✅ Availability row updated:", {
      id: updated._id,
      actId: updated.actId,
      musicianId: updated.musicianId,
      reply: updated.reply,
    });

    // Load act + resolve musician
    const act = updated.actId ? await Act.findById(updated.actId).lean() : null;
    const musician = updated.musicianId
      ? await Musician.findById(updated.musicianId).lean()
      : null;

    console.log("🎭 Loaded act + musician:", {
      actFound: !!act,
      actName: act?.tscName || act?.name,
      musicianFound: !!musician,
      musicianName: musician?.firstName || musician?.fullName,
      musicianEmail: musician?.email,
    });

    // Compute invite + badge
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
        await rebuildavailabilityBadges(
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
await rebuildAndApplyBadge(updated.actId, updated.dateISO);
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
    await rebuildAndApplyBadge(updated.actId, updated.dateISO);
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

// -------------------- Delivery/Read Receipts --------------------
// module-scope guard so we don't double-fallback on Twilio retries
export const twilioStatus = async (req, res) => {
   console.log(`🟢 (availabilityController.js) twilioStatus START at ${new Date().toISOString()}`, {
 });
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
    const toSMS  = toAddr.replace(/^whatsapp:/i, "");       // "+44…" for SMS

    const code = Number(ErrorCode) || null;
    const needsFallback =
      isWA && (status === "failed" || status === "undelivered" || code === 63024);

    console.log("📡 Twilio status:", {
      sid: MessageSid,
      status,
      to: toAddr,
      from: From,
      err: ErrorCode || null,
      errMsg: ErrorMessage || null,
      body: String(req.body?.Body || "").slice(0, 100) || null,
    });

    // If we can't send an SMS anyway, nothing else to do
    if (!toSMS) return res.status(200).send("OK");

    // Only handle WA→SMS fallback once per WA SID
    if (needsFallback && MessageSid && !_waFallbackSent.has(MessageSid)) {
      _waFallbackSent.add(MessageSid);

     // --- INSIDE twilioStatus, right before you call sendSMSMessage(toSMS, smsBody) ---

// 1) Find the outbound info saved at send time (same as you have)
const av = await AvailabilityModel.findOne({ messageSidOut: MessageSid }).lean();
const em = await EnquiryMessage.findOne({ messageSid: MessageSid }).lean();

// 2) Prefer the EXACT saved smsBody from send time
let smsBody =
  (av && av.outbound && av.outbound.smsBody) ||
  (em && em.smsBody) ||
  "";

// 3) If missing, rebuild from stored fields (no “test” fallbacks)
if (!smsBody) {
  const firstName =
    (em?.meta?.firstName && String(em.meta.firstName).trim()) ||
    (em?.templateParams?.FirstName && String(em.templateParams.FirstName).trim()) ||
    (av?.contactName && String(av.contactName).trim()) ||
    (av?.musicianName && String(av.musicianName).trim().split(/\s+/)[0]) ||
    "there";

  const formattedDate    = em?.formattedDate    || av?.formattedDate    || "";
  const formattedAddress = em?.formattedAddress || av?.formattedAddress || "";
  const fee              = em?.fee              || av?.fee              || "";
  const duties           = em?.duties           || av?.duties           || "performance";
  const actName          = (em?.meta?.actName)  || av?.actName          || "the band";

  smsBody = buildAvailabilitySMS({
    firstName,
    formattedDate,
    formattedAddress,
    fee,
    duties,
    actName,
  });
}

// 4) Log the ACTUAL SMS we will send (this is what you want to see)
console.log("✉️  SMS fallback body:", { to: toSMS, preview: smsBody.slice(0, 140) });

// 5) Send the SMS
const smsRes = await sendSMSMessage(toSMS, smsBody);
console.log("✅ SMS fallback sent:", { sid: smsRes?.sid, status: smsRes?.status, to: toSMS });

// (persist sms fallback sid as you already do)
if (av?._id) {
  await AvailabilityModel.updateOne(
    { _id: av._id },
    { $set: { "outbound.smsFallbackSid": smsRes?.sid || null, "outbound.smsFallbackAt": new Date() } }
  );
}
    }

    return res.status(200).send("OK"); // Twilio expects 2xx
  } catch (e) {
    console.error("❌ twilioStatus error:", e);
    return res.status(200).send("OK"); // still 200 so Twilio stops retrying
  }
};
// -------------------- Inbound from Twilio --------------------
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
// availabilityController.js (export this)
export async function pingDeputiesFor(actId, lineupId, dateISO, formattedAddress, duties) {
   console.log(`🟢 (availabilityController.js) pingDeputiesFor START at ${new Date().toISOString()}`, {
 });
  const act = await Act.findById(actId).lean();
  if (!act) return;
  const fakeUpdated = {
    actId,
    lineupId,
    phone: "", // not used
    dateISO,
    formattedDate: formatWithOrdinal(dateISO),
    formattedAddress: formattedAddress || "",
    duties: duties || "your role",
    fee: "",
  };
  await handleLeadNegativeReply({ act, updated: fakeUpdated });
}

export const notifyMusician = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) notifyMusician called at`, new Date().toISOString(), {
  phone: req.body.phone,
});
    const { phone, message } = req.body;
  
    if (!phone || !message) {
      console.error("❌ Missing fields in request body:", req.body);
      return res.status(400).json({ success: false, message: "Phone or message missing" });
    }
  
    console.log("📞 Would send message to:", phone);
    console.log("📨 Message:", message);
  
    try {
      // Convert UK 07... numbers to +447... format for WhatsApp
      const formattedPhone = phone.startsWith('07') ? phone.replace(/^0/, '+44') : phone;
      await sendWhatsAppMessage(formattedPhone, message);
      return res.status(200).json({ success: true, message: "WhatsApp message sent" });
    } catch (error) {
      console.error("❌ Error sending WhatsApp:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

export const shortlistActAndTrack = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) shortlistActAndTrack called at`, new Date().toISOString(), {
  body: req.body,
});
  try {
    const { userId, actId } = req.body;
    if (!userId || !actId) return res.status(400).json({ success: false, message: 'Missing userId or actId' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    console.log("🔍 User found:", user._id, "Shortlisted acts before:", user.shortlistedActs, user);
    if (!user.shortlistedActs.includes(actId)) {
      user.shortlistedActs.push(actId);
      await user.save();
      await Act.findByIdAndUpdate(actId, { $inc: { timesShortlisted: 1 } });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
  
  export const whatsappReplyHandler = async (req, res) => {
    console.log(`🐠 (controllers/shortlistController.js) whatsappReplyHandler called at`, new Date().toISOString(), {
  from: req.body.From,
  body: req.body.Body,
});
    console.log("🌍 Webhook HIT");
    const reply = req.body.Body?.trim().toLowerCase();
    const message = req.body.Body || '';
    const fee = req.body.fee ? `£${req.body.fee}` : (() => {
      const feeMatch = message.match(/£(\d+)/);
      return feeMatch ? `£${feeMatch[1]}` : 'Not specified';
    })();
  
    const normalizePhone = (phone) => {
      if (!phone) return null;
      let cleaned = phone.replace(/\s+/g, '');
      if (cleaned.startsWith('whatsapp:')) cleaned = cleaned.replace('whatsapp:', '');
      if (!cleaned.startsWith('+')) {
        if (cleaned.startsWith('07')) {
          return cleaned.replace(/^0/, '+44');
        } else if (cleaned.startsWith('44')) {
          return '+' + cleaned;
        }
      }
      return cleaned;
    };
  
    const from = normalize(req.body.From || "");
    const candidates = Array.from(new Set([
      from,                                             // +4478…
      (req.body.From || "").replace(/^whatsapp:/i, ''), // raw +4478…
      from.replace(/^\+44/, '0'),                       // 07…
      from.replace(/^\+44/, '44'),                      // 4478…
    ]));
    console.log("🔎 Musician phone candidates:", candidates);
  
    // Try to find the musician by any of the common phone formats or in basicInfo.phone
    const musician = await Musician.findOne({
      $or: [
        { phone: { $in: candidates } },
        { 'basicInfo.phone': { $in: candidates } },
      ]
    });
    if (!musician) {
      console.warn("⚠️ No musician matched for inbound", { from, candidates });
      return res.status(200).send('<Response/>');
    }
  
    const parsedDate = req.body.date
      ? new Date(req.body.date)
      : (() => {
          const fallbackDateMatch = message.match(/\b(?:on|for)?\s*(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
          if (fallbackDateMatch) {
            const [, day, , month, year] = fallbackDateMatch;
            return new Date(`${day} ${month} ${year}`);
          }
          return new Date();
        })();
    const incomingDate = req.body.date || null;
    console.log("📅 Incoming date from WhatsApp webhook:", incomingDate, "-> Parsed:", parsedDate);

    // Try to identify act for this reply:
    // 1) direct actId from webhook body if your template sends it
    // 2) or parse "Ref: <actId>" if included in the body text
    const actIdFromBody =
      req.body.actId ||
      (message.match(/Ref:\s*([a-f0-9]{24})/i)?.[1] ?? null);

    const act = actIdFromBody ? await Act.findById(actIdFromBody).lean() : null;

    // Try to correlate this reply to the latest outbound enquiry for this musician (by phone)
    let enquiry = await EnquiryMessage.findOne({
      musicianId: musician._id,
      ...(act?._id ? { actId: act._id } : {}),
      ...(incomingDate ? { 'meta.MetaISODate': incomingDate } : {}),
    }).sort({ createdAt: -1 });

    if (enquiry) {
      await EnquiryMessage.updateOne(
        { _id: enquiry._id },
        { $set: { status: reply, reply, repliedAt: new Date() } }
      );
    } else {
      // Fallback: tie by phone only if nothing matched
      enquiry = await EnquiryMessage.findOneAndUpdate(
        { phone: { $in: candidates } },
        { $set: { status: reply, reply, repliedAt: new Date() } },
        { sort: { createdAt: -1 }, new: true }
      );
    }

    try {
      const availability = await Availability.create({
        musicianId: musician._id,
        actId: act?._id,
        date: parsedDate,
        address: req.body.address || 'TBC',
        reply,
        enquiryMessageId: enquiry?._id || null,
      });
      console.log("✅ Availability saved:", availability._id.toString(), reply);
  
      if (!musician.availability) {
        musician.availability = [];
      }
      musician.availability.push(availability._id);
      await musician.save();
      console.log(`✅ Saved availability for ${musician.firstName} ${musician.lastName}`);
  
      // Create templateParams for Twilio message
      const templateParams = {
        '1': musician.firstName, // Musician's name
        '2': parsedDate.toDateString(), // Date
        '3': req.body.address || 'Not provided', // Location
        '4': fee, // Fee
        '5': musician.instrument || 'Not specified', // Instrument
        '6': act?.tscName || ''
      };
  
      // Send WhatsApp message with template
      const formattedPhone = from.startsWith('07') ? from.replace(/^0/, '+44') : from;
      await sendWhatsAppMessage(
        formattedPhone,  // Send message to musician's phone
        `Hi {{1}}! Are you available on {{2}} for a gig in {{3}} at a rate of £{{4}} for {{5}} duties with {{6}}?`,  // Template message
        templateParams   // Template parameters
      );
  
      if (reply === 'yes') {
        const start = new Date(parsedDate);
        start.setHours(17, 0, 0, 0); // Set start time to 5pm local time
  
        const end = new Date(start);
        end.setHours(23, 59, 0, 0); // Set end time to midnight local time
  
        // Append this enquiry to the existing calendar event's description if one already exists
        const existingEvent = null; // Placeholder: implement calendar event lookup logic if needed
  
        const descriptionLine = `Enquiry for ${parsedDate.toDateString()} at ${req.body.address} for ${fee}`;
        const description = existingEvent?.description
          ? `${existingEvent.description}\n${descriptionLine}`
          : descriptionLine;
  
        await createCalendarInvite({
          enquiryId,
          email: musician.email,
          summary: `TSC: Enquiry`,
          description,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        });
  
        console.log(`📆 Calendar invite sent to ${musician.email}`);
      }
  
      // Determine if this musician is a lead in any lineup of this act
      if (act) {
        const allMembers = (act.lineups || []).flatMap(l =>
          Array.isArray(l.bandMembers) ? l.bandMembers : []
        );
        const vocalRoles = ["Lead Male Vocal","Lead Female Vocal","Lead Vocal","vocalist-guitarist"];
        const isLead = allMembers.some(m =>
          (m.musicianId?.toString?.() === musician._id.toString()) &&
          vocalRoles.includes(m.instrument)
        );
  
        if (reply === 'yes') {
          // Broadcast to frontend via SSE -> triggers toast + badge
          const payload = {
            actId: act._id.toString(),
            actName: act.tscName,
            musicianName: musician.firstName,
            dateISO: parsedDate.toISOString(),
          };
          if (isLead) availabilityNotify.leadYes(payload);
          else availabilityNotify.deputyYes(payload);
        }
  
        // On NO/UNAVAILABLE escalate to first deputy not equal to current musician
        if (reply === 'no' || reply === 'unavailable') {
          const vocalists = allMembers.filter(m => vocalRoles.includes(m.instrument));
          const deputies = [];
          for (const v of vocalists) {
            const deps = Array.isArray(v.deputies) ? v.deputies : [];
            for (const d of deps) deputies.push(d);
          }
          const nextDep = deputies.find(d => {
            const id = (d.musicianId?.toString?.() || d?._id?.toString?.() || "").toString();
            return id && id !== musician._id.toString();
          });
  
          if (nextDep && (nextDep.phoneNumber || nextDep.phone)) {
            const phone = (nextDep.phoneNumber || nextDep.phone).replace(/^0/, "+44");
            await sendWhatsAppMessage(phone, {
              FirstName: nextDep.firstName || "there",
              FormattedDate: parsedDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
              FormattedAddress: (req.body.address || "TBC"),
              Fee: (req.body.fee != null && String(req.body.fee).trim() !== "" ? String(req.body.fee).replace(/^£/, ""): 'TBC'),
              Duties: member.instrument,
              ActName: act.tscName,
            });
          }
        }
      }
    } catch (err) {
      console.error("❌ Error processing WhatsApp reply:", err.message);
    }
  
    res.send('<Response></Response>');
  };