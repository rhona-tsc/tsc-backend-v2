
import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { createCalendarInvite, updateCalendarEvent } from "../controllers/googleController.js";
import { sendSMSMessage } from "../utils/twilioClient.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { postcodes } from "../utils/postcodes.js"; // <-- ensure this path is correct in backend

const SMS_FALLBACK_LOCK = new Set(); // key: WA MessageSid; prevents duplicate SMS fallbacks
const normCountyKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, "_");

function classifyReply(text) {
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
  const v = String(s || "").trim();
  return v ? v.split(/\s+/)[0] : "there";
};


function extractOutcode(address = "") {
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
  if (typeof obj.profilePicture === "string" && obj.profilePicture.trim().startsWith("http")) {
    return obj.profilePicture;
  }
  return "";
};

// Build the exact SMS text we want for both send-time and fallback - THIS IS THE SMS TO LEAD VOCALISTS TO CHECK AVAILABILITY! (not used for booking confirmations)
function buildAvailabilitySMS({ firstName, formattedDate, formattedAddress, fee, duties, actName }) {
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

// Send the booking-request message to ALL performers in a lineup
export async function sendBookingRequestToLineup({ actId, lineupId, date, address }) {
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

const toWhatsAppPhone = (raw = "") => {
  let v = String(raw).trim();
  if (!v) return "";
  v = v.replace(/\s+/g, "");
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v; // assume already intl
};

// ---- Allocation sync with Booking Board ----
async function refreshAllocationForActDate(actId, dateISO) {
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

// --- helpers ---

// --- helpers (top of availability controller)
const pickFirst = (...vals) =>
  vals.find(v => typeof v === "string" && v.trim().startsWith("http")) || "";

/**
 * Only resolve a photo from the *matched* vocalist (who) or their musicianDoc.
 * Never fall back to other members or generic act photos.
 */
function resolveMatchedMusicianPhoto({ who, musicianDoc }) {
  const fromWho = getPictureUrlFrom(who || {});
  const fromDoc = getPictureUrlFrom(musicianDoc || {});
  return fromWho || fromDoc || "";
}

/**
 * Find a member or deputy inside an act's lineups using a musicianId/_id.
 * Returns { type: "member"|"deputy", person, parentMember, lineup } or null.
 */
function findPersonByMusicianId(act, musicianId) {
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



async function resolveMusicianPhoto(person) {
  if (!person) return "";

  // 1) Prefer any image URLs directly present on the matched person (member or deputy)
  const direct = getPictureUrlFrom(person || {});
  if (direct) return direct;

  // 2) Only look up in Musician by strong identifiers (musicianId or email).
  //    Do NOT search by phone — that can collide with the core member's phone and return the wrong photo.
  try {
    const query = [];
    if (person.musicianId) query.push({ _id: person.musicianId });
    if (person.email) query.push({ email: person.email });
    if (person.emailAddress) query.push({ email: person.emailAddress });

    if (!query.length) return "";

    const mus = await Musician.findOne({ $or: query })
      .select("musicianProfileImageUpload profileImage profilePicture.url photoUrl imageUrl")
      .lean();

    const fromMusician = getPictureUrlFrom(mus || {});

    return fromMusician || "";
  } catch (e) {
    console.warn("⚠️ resolveMusicianPhoto failed:", e?.message || e);
    return "";
  }
}

// --- New helpers for badge rebuilding ---
const isVocalRoleGlobal = (role = "") => {
  const r = String(role || "").toLowerCase();
  return [
    "lead male vocal", "lead female vocal", "lead vocal",
    "vocalist-guitarist", "vocalist-bassist", "mc/rapper",
    "lead male vocal/rapper", "lead female vocal/rapper",
    "lead male vocal/rapper & guitarist", "lead female vocal/rapper & guitarist",
  ].includes(r);
};

const normalizePhoneE164 = (raw = "") => {
  let v = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

async function getDeputyDisplayBits(dep) {
  // Return { musicianId, photoUrl, profileUrl }
  const PUBLIC_SITE_BASE = (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");

  try {
    // Prefer an explicit musicianId if present, else fall back to embedded _id
    const musicianId = (dep?.musicianId && String(dep.musicianId)) || (dep?._id && String(dep._id)) || "";

    // 1) Try to read an image directly from the deputy object (handles both string or {url} shapes)
    let photoUrl = getPictureUrlFrom(dep || {});

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
          photoUrl = getPictureUrlFrom(musByEmail || "");
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
    const profileUrl = fallbackId ? `${(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "")}/musician/${fallbackId}` : "";
    return { musicianId: fallbackId, photoUrl: "", profileUrl };
  }
}
// Debug helper: given a phone number, log the Musician doc(s) that match and their image fields
async function debugLogMusicianByPhone(phoneRaw) {
  try {
    const variants = normalizeFrom(phoneRaw || ""); // ["+447...","07...","447..."]
    if (!variants.length) return;

    const mus = await Musician.find({
      $or: [
        { phone: { $in: variants } },
        { phoneNumber: { $in: variants } },
      ],
    })
      .select("firstName lastName email phone phoneNumber musicianProfileImageUpload profileImage profilePicture.url photoUrl imageUrl")
      .lean();

    console.log("🔎 debugLogMusicianByPhone", {
      input: phoneRaw,
      variants,
      matches: mus.map(m => ({
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
      }))
    });
  } catch (e) {
    console.warn("⚠️ debugLogMusicianByPhone failed:", e?.message || e);
  }
}

export const clearAvailabilityBadge = async (req, res) => {
  try {
    const { actId } = req.body;
    if (!actId)
      return res.status(400).json({ success: false, message: "Missing actId" });

    await Act.findByIdAndUpdate(actId, {
      $set: { "availabilityBadge.active": false },
      $unset: {
        "availabilityBadge.vocalistName": "",
        "availabilityBadge.inPromo": "",
        "availabilityBadge.dateISO": "",
        "availabilityBadge.musicianId": "",
        "availabilityBadge.address": "",
        "availabilityBadge.setAt": "",
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ clearAvailabilityBadge error", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
};

const parseHumanDate = (s) => {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})(st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  let [, dd, , mon, yyyy] = m;
  dd = dd.padStart(2, "0");
  const map = {
    january: "Jan",
    february: "Feb",
    march: "Mar",
    april: "Apr",
    may: "May",
    june: "Jun",
    july: "Jul",
    august: "Aug",
    september: "Sep",
    sept: "Sep",
    october: "Oct",
    november: "Nov",
    december: "Dec",
  };
  const key = mon.toLowerCase();
  const mon3 = map[key] || mon.slice(0, 3);
  return new Date(`${dd} ${mon3} ${yyyy}`);
};

// -------------------- Utilities --------------------

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

 const BASE_URL = (process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || process.env.INTERNAL_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
;

const NORTHERN_COUNTIES = new Set([
"ceredigion", "cheshire", "cleveland", "conway", "cumbria", "denbighshire", "derbyshire", "durham", "flintshire", "greater manchester", "gwynedd", "herefordshire", "lancashire", "leicestershire", "lincolnshire", "merseyside", "north humberside", "north yorkshire", "northumberland", "nottinghamshire", "rutland", "shropshire", "south humberside", "south yorkshire", "staffordshire", "tyne and wear", "warwickshire", "west midlands", "west yorkshire", "worcestershire", "wrexham", "rhondda cynon taf", "torfaen", "neath port talbot", "bridgend", "blaenau gwent", "caerphilly", "cardiff", "merthyr tydfil", "newport", "aberdeen city", "aberdeenshire", "angus", "argyll and bute", "clackmannanshire", "dumfries and galloway", "dundee city", "east ayrshire", "east dunbartonshire", "east lothian", "east renfrewshire", "edinburgh", "falkirk", "fife", "glasgow", "highland", "inverclyde", "midlothian", "moray", "na h eileanan siar", "north ayrshire", "north lanarkshire", "orkney islands", "perth and kinross", "renfrewshire", "scottish borders", "shetland islands", "south ayrshire", "south lanarkshire", "stirling", "west dunbartonshire", "west lothian"
]);



// Availability controller: robust travel fetch that supports both API shapes
const fetchTravel = async (origin, destination, dateISO) => {
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

// Format date like "Saturday, 5th Oct 2025"
const formatWithOrdinal = (dateLike) => {
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
  try {
    console.log("🛎 triggerAvailabilityRequest", req.body);

    const { actId, lineupId, date, address } = req.body;
    if (!actId || !date || !address) {
      return res
        .status(400)
        .json({ success: false, message: "Missing actId/date/address" });
    }

    const act = await Act.findById(actId).lean();
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    const dateISO = new Date(date).toISOString().slice(0, 10);
    const formattedDate = formatWithOrdinal(date);
    const shortAddress = (address || "")
      .split(",")
      .slice(-2)
      .join(",")
      .replace(/,\s*UK$/i, "")
      .trim();

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

    // Normalise to E.164-ish (+44...) for lookups against Musician.phoneNormalized
function normalizeToE164(raw = "") {
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
}

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

  // Try WA then fallback to SMS
const smsBody = buildAvailabilitySMS({
  firstName: firstNameOf(lead),
  formattedDate,
  formattedAddress: shortAddress,
  fee: String(finalFee),
  duties: lead.instrument || "your role",
  actName: act.tscName || act.name || "the act",
});

  const sendRes = await sendWhatsAppMessage({
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
    smsBody,
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

// -------------------- SSE Broadcaster --------------------

export const makeAvailabilityBroadcaster = (broadcastFn) => ({
  leadYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({type: "availability_yes",actId,actName,musicianName,dateISO,});  },
  deputyYes: ({ actId, actName, musicianName, dateISO }) => {
    broadcastFn({ type: "availability_deputy_yes", actId,  actName, musicianName,dateISO, });},});

const INBOUND_SEEN = new Map(); 
const INBOUND_TTL_MS = 10 * 60 * 1000; 

function seenInboundOnce(sid) {
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
async function buildAvailabilityBadgeFromRows(act, dateISO) {
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
            address: act?.availabilityBadge?.address || "",
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
          address: act?.availabilityBadge?.address || "",
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



export const twilioInbound = async (req, res) => {
  try {
    const bodyText = String(req.body?.Body || "");
    const buttonText = String(req.body?.ButtonText || "");
    const buttonPayload = String(req.body?.ButtonPayload || "");
    const inboundSid = String(req.body?.MessageSid || "");
const fromRaw = String(req.body?.WaId || req.body?.From || req.body?.Author || "");
const toRaw   = String(req.body?.To || "");
console.log("🔭 Inbound addresses:", { From: fromRaw, To: toRaw });

    // Dedup
    if (seenInboundOnce(inboundSid)) {
      console.log("🪵 Duplicate inbound — already handled", { MessageSid: inboundSid });
      return res.status(200).send("<Response/>");
    }

    console.log("📩 Twilio inbound webhook:", {
      From: fromRaw, Body: bodyText, ButtonText: buttonText, ButtonPayload: buttonPayload, MessageSid: inboundSid,
    });

    const noContent = !buttonPayload && !buttonText && !bodyText;
    if (noContent) {
      console.log("🪵 Ignoring empty inbound message", { From: fromRaw, MessageSid: inboundSid });
      return res.status(200).send("<Response/>");
    }

    if (inboundSid) {
      const dup = await AvailabilityModel.findOne({ "inbound.sid": inboundSid }).lean();
      if (dup) {
        console.log("🪵 Duplicate inbound detected, skipping", inboundSid);
        return res.status(200).send("<Response/>");
      }
    }

    // 1) Classify reply
    const combinedText = `${buttonText} ${buttonPayload} ${bodyText}`.trim();
    if (!combinedText) return res.status(204).send("<Response/>");

    let { reply, enquiryId } = parsePayload(buttonPayload);
    if (!reply) reply = classifyReply(buttonText) || classifyReply(bodyText) || null;
    if (!reply) {
      console.log("🤷 Unrecognised reply text, ignoring:", combinedText);
      return res.status(204).send("<Response/>");
    }

    // 2) Update the matching Availability row
    let updated = null;
    if (enquiryId) {
      updated = await AvailabilityModel.findOneAndUpdate(
        { enquiryId },
        {
          $set: {
            reply,
            repliedAt: new Date(),
            "inbound.sid": inboundSid || undefined,
            "inbound.body": bodyText || undefined,
            "inbound.buttonText": buttonText || undefined,
            "inbound.buttonPayload": buttonPayload || undefined,
          },
        },
        { new: true }
      );
    }
    if (!updated) {
      const candidates = normalizeFrom(fromRaw); // ["+447…","07…","447…"]
      if (candidates.length) {
        updated = await AvailabilityModel.findOneAndUpdate(
          { phone: { $in: candidates } },
          {
            $set: {
              reply,
              repliedAt: new Date(),
              "inbound.sid": inboundSid || undefined,
              "inbound.body": bodyText || undefined,
              "inbound.buttonText": buttonText || undefined,
              "inbound.buttonPayload": buttonPayload || undefined,
            },
          },
          { sort: { createdAt: -1 }, new: true }
        );
      }
    }
    if (!updated) {
      console.warn("⚠️ No Availability row matched this reply (missing enquiryId and phone fallback failed).");
      return res.status(200).send("<Response/>");
    }

    // === Save reply timestamp + release deferred queue for this phone ===
await AvailabilityModel.updateOne(
  { _id: updated._id },
  { $set: { reply, updatedAt: new Date() } }
);


// Release next deferred enquiry (if any) for this phone
try {} catch (e) {
  console.warn("⚠️ deferred release failed:", e?.message || e);
}



    // 3) Load Act
    const act = updated.actId ? await Act.findById(updated.actId).lean() : null;

    // 4) Resolve email + person
    let musicianDoc = null;
    let personFromAct = null;
    let musicianEmail = null;

    if (updated.musicianId) {
      musicianDoc = await Musician.findById(updated.musicianId).lean();
      musicianEmail = musicianDoc?.email || null;
    }
    if (!musicianEmail && act) {
      let match = findPersonByPhone(act, updated.lineupId, updated.phone || fromRaw);
      personFromAct = match?.person || null;

      if (!personFromAct) {
        match = findPersonByPhone(act, null, updated.phone || fromRaw);
        personFromAct = match?.person || null;
      }

      musicianEmail =
        match?.person?.email ||
        match?.person?.emailAddress ||
        personFromAct?.email ||
        personFromAct?.emailAddress ||
        null;
    }
    if (!musicianEmail && personFromAct) {
      try {
        const byPhoneOrEmail = await Musician.findOne({
          $or: [
            { phone: personFromAct.phone || personFromAct.phoneNumber },
            { email: personFromAct.email || personFromAct.emailAddress },
          ],
        }).select("email").lean();
        musicianEmail = byPhoneOrEmail?.email || null;
      } catch {}
    }
    if (!musicianEmail) {
      musicianEmail = updated.calendarInviteEmail || null;
    }

    // 5) Event date
    const eventDate = updated.dateISO
      ? new Date(`${updated.dateISO}T00:00:00`)
      : parseHumanDate(updated.formattedDate);

    // 6) Log decision
    console.log("🎯 Calendar invite decision:", {
      reply,
      enquiryId: updated.enquiryId,
      fromVariants: normalizeFrom(fromRaw),
      actId: updated.actId?.toString?.() || null,
      lineupId: updated.lineupId?.toString?.() || null,
      availabilityPhone: updated.phone,
      resolvedEmail: musicianEmail,
      resolvedFrom: musicianDoc ? "Musician model" : personFromAct ? "Act lineup (member/deputy)" : "none",
      eventDateISO: eventDate?.toISOString?.() || null,
      formattedDate: updated.formattedDate,
      formattedAddress: updated.formattedAddress,
    });

    // 7) YES → apply badge once (with resolved photo + musicianId)
    if (reply === "yes" && updated.actId && act) {
      let who = null;
      let isDeputy = false;

      // Prefer exact by musicianId
      let match = updated.musicianId ? findPersonByMusicianId(act, updated.musicianId) : null;
      if (match) {
        who = match.person;
        isDeputy = !!match.parentMember;
      }

      // Fallback by phone in lineup, then all lineups
      if (!who) {
        match = findPersonByPhone(act, updated.lineupId, updated.phone || fromRaw) ||
                findPersonByPhone(act, null,       updated.phone || fromRaw);
        if (match) {
          who = match.person;
          isDeputy = !!match.parentMember;
        }
      }

      // Helpful debug
      await debugLogMusicianByPhone(updated.phone || fromRaw);

      // Get a musician doc for the matched person if needed
      let docForPhoto = musicianDoc;
      if (who?.musicianId && (!docForPhoto || String(docForPhoto._id) !== String(who.musicianId))) {
        try { docForPhoto = await Musician.findById(who.musicianId).lean(); } catch {}
      }
      if (!docForPhoto && (who?.email || who?.emailAddress)) {
        try { docForPhoto = await Musician.findOne({ email: who.email || who.emailAddress }).lean(); } catch {}
      }
      // As a last resort, try phoneNormalized (module-level helper is normalizePhoneE164)
      if (!docForPhoto) {
        try {
          const e164 = normalizePhoneE164(updated.phone || fromRaw);
          if (e164) {
            const byPhone = await Musician.findOne({
              $or: [
                { phoneNormalized: e164 },
                { phone: e164 },
                { phoneNumber: e164 },
              ],
            })
              .select("_id musicianProfileImageUpload profileImage profilePicture.url photoUrl imageUrl firstName lastName")
              .lean();
            if (byPhone) docForPhoto = byPhone;
          }
        } catch (e) {
          console.warn("⚠️ phoneNormalized lookup failed:", e?.message || e);
        }
      }

      // Resolve photo strictly from the matched vocalist
      let resolvedPhotoUrl = resolveMatchedMusicianPhoto({ who, musicianDoc: docForPhoto });
      if (!resolvedPhotoUrl && docForPhoto) {
        // tiny safety net for unusual field shapes
        const pic =
          (typeof docForPhoto.musicianProfileImageUpload === "string" && docForPhoto.musicianProfileImageUpload) ||
          (typeof docForPhoto.musicianProfileImage === "string" && docForPhoto.musicianProfileImage) ||
          (typeof docForPhoto.profileImage === "string" ? docForPhoto.profileImage : docForPhoto.profileImage?.url) ||
          (typeof docForPhoto.profilePicture === "string" ? docForPhoto.profilePicture : docForPhoto.profilePicture?.url) ||
          docForPhoto.photoUrl ||
          docForPhoto.imageUrl ||
          "";
        if (pic) resolvedPhotoUrl = pic;
      }

      const vocalistName = [who?.firstName, who?.lastName].filter(Boolean).join(" ");
      const resolvedMusicianId =
        (who?.musicianId && String(who.musicianId)) ||
        (updated?.musicianId && String(updated.musicianId)) ||
        (docForPhoto?._id && String(docForPhoto._id)) ||
        (musicianDoc?._id && String(musicianDoc._id)) ||
        "";

      const badgeSet = {
        "availabilityBadge.active": true,
        "availabilityBadge.isDeputy": isDeputy,
        "availabilityBadge.inPromo": !!who?.inPromo,
        "availabilityBadge.vocalistName": vocalistName || (updated?.name || "").trim(),
        "availabilityBadge.photoUrl": resolvedPhotoUrl || "",
        "availabilityBadge.musicianId": resolvedMusicianId || "",
        "availabilityBadge.dateISO": updated.dateISO || null,
        "availabilityBadge.address": updated.formattedAddress || "",
        "availabilityBadge.setAt": new Date(),
      };

      await Act.updateOne({ _id: act._id }, { $set: badgeSet });

      console.log("🏷️ Applying badge", {
        actId: updated.actId,
        vocalistName,
        isDeputy,
        candidatePhones: [who?.phone, who?.phoneNumber, musicianDoc?.phone],
        photoUrl: resolvedPhotoUrl,
      });
    }

    // 8) NO/UNAVAILABLE → clear badge and top up deputies to 3
    if (updated && (reply === "no" || reply === "unavailable")) {
      try {
        await Act.updateOne(
          { _id: updated.actId },
          {
            $set: { "availabilityBadge.active": false },
            $unset: {
              "availabilityBadge.vocalistName": "",
              "availabilityBadge.inPromo": "",
              "availabilityBadge.isDeputy": "",
              "availabilityBadge.photoUrl": "",
              "availabilityBadge.musicianId": "",
              "availabilityBadge.dateISO": "",
              "availabilityBadge.address": "",
              "availabilityBadge.setAt": "",
            },
          }
        );
        console.log("🏷️ Cleared availability badge due to reply:", reply);
      } catch (e) {
        console.warn("⚠️ Failed to clear availability badge:", e?.message || e);
      }

      if (act && typeof handleLeadNegativeReply === "function") {
        console.log("🚨 Lead replied negative, checking deputies…", {
          actId: String(updated.actId || ""),
          lineupId: updated.lineupId?.toString?.(),
          leadPhone: updated.phone,
          duties: updated.duties,
        });

        await handleLeadNegativeReply({ act, updated, fromRaw });
      } else {
        // Fallback: keep your existing single-deputy logic here if you haven't added handleLeadNegativeReply yet
      }

      // Auto-reply to NO/UNAVAILABLE
try {
  await sendSMSMessage(
    normalizeToE164(updated.phone || fromRaw),
    "Thanks for letting us know — we’ve updated your availability!"
  );
} catch (e) {
  console.warn("[twilioInbound] auto-reply NO failed:", e?.message || e);
}
// After clearing the badge (inside NO/UNAVAILABLE)
try {
  await pingDeputiesFor(
    updated.actId,
    updated.lineupId,
    updated.dateISO,
    updated.formattedAddress,
    updated.duties
  );
} catch (e) {
  console.warn("⚠️ pingDeputiesFor failed:", e?.message || e);
}
    }

    // 9) YES → calendar invite
// 9) YES → create calendar invite + send ONE confirmation SMS (no WA)
if (reply === "yes") {
  // pull details from the Availability row you just updated
  const firstName         = (updated?.contactName || "").trim() || "there";
  const duties            = updated?.duties || "performance";
  const fee               = updated?.fee || "TBC";
  const formattedDate     = updated?.formattedDate || "the date discussed";
  const formattedAddress  = updated?.formattedAddress || "test 2 the area";
  const actIdStr          = String(updated?.actId || "");
  const dateISOday        = String((updated?.dateISO || "").slice(0, 10));
  const toE164            = normalizeToE164(updated?.phone || fromRaw);

  // try to resolve the musician's email (use what you already found above)
// Use the value resolved earlier, or fall back to what's on the Availability row
const emailForInvite =
  (typeof musicianEmail === "string" && musicianEmail) ||
  updated?.calendarInviteEmail ||
  null;

  if (emailForInvite && dateISOday) {
    const desc =
      `TSC enquiry:\n` +
      `Act: ${updated?.actName || ""}\n` +
      `Role: ${duties}\n` +
      `Rate: £${String(fee)}\n` +
      `Address: ${formattedAddress}\n` +
      `Date: ${formattedDate}`;
      

    try {
      const event = await createCalendarInvite({
        enquiryId: updated.enquiryId,
        actId: actIdStr,
        dateISO: dateISOday, // 'YYYY-MM-DD'
        email: emailForInvite,
        summary: "TSC: Enquiry",
        description: desc,
        startTime: `${dateISOday}T17:00:00.000Z`,
        endTime:   `${dateISOday}T23:59:00.000Z`,
        extendedProperties: { private: { actId: actIdStr, dateISO: dateISOday, enquiryId: updated.enquiryId } },
      });

      console.log("📆 Calendar invite created:", {
        eventId: event?.data?.id, attendee: emailForInvite,
      });


// NEW: make absolutely sure the singer is on the attendees list
try {
  await updateCalendarEvent({
    eventId: event?.data?.id || event?.id,
    ensureAttendees: [emailForInvite],
  });
} catch (e) {
  console.warn("⚠️ ensureAttendee patch failed:", e?.message || e);
}

      await AvailabilityModel.updateOne(
        { _id: updated._id },
        {
          $set: {
            calendarEventId: event?.data?.id || null,
            ...(updated.calendarInviteEmail ? {} : { calendarInviteEmail: emailForInvite }),
            calendarInviteSentAt: new Date(),
            calendarStatus: "needsAction",
          },
        }
      );
    } catch (calErr) {
      console.warn("⚠️ Calendar invite failed:", calErr?.message || calErr);
    }
  } else {
    console.warn("⚠️ Skipped calendar invite — missing musician email or date.", {
      emailForInvite, dateISO: updated?.dateISO,
    });
  }

  // ONE confirmation SMS (personalised). No WhatsApp here → avoids fallback duplication.
  try {
    const msg =
      `Super — we’ll send a diary invite to log the enquiry for your records.`;
    await sendSMSMessage(toE164, msg);
  } catch (e) {
    console.warn("[twilioInbound] YES confirmation SMS failed:", e?.message || e);
  }

  // short-circuit; we’ve done all YES work and avoided any WA send
  return res.status(200).send("<Response/>");
}


    // 10) Save reply, refresh allocation, broadcast SSE
    console.log(`✅ Reply saved for enquiryId=${updated.enquiryId || "N/A"} → ${updated.reply}`);

    try {
      await refreshAllocationForActDate(updated.actId, updated.dateISO);
    } catch (e) {
      console.warn("⚠️ Allocation refresh after inbound failed:", e?.message || e);
    }

    const broadcast = req.app?.get?.("availabilityBroadcast");
    if (broadcast && updated?.reply) {
      broadcast({
        type:
          updated.reply === "yes"
            ? "availability_yes"
            : updated.reply === "no"
            ? "availability_no"
            : "availability_unavailable",
        actId: String(updated.actId || ""),
        actName: act?.tscName || act?.name || "",
        musicianName:
          (musicianDoc?.firstName || personFromAct?.firstName || "") +
          " " +
          (musicianDoc?.lastName || personFromAct?.lastName || ""),
        dateISO:
          updated.dateISO ||
          eventDate?.toISOString?.() ||
          new Date().toISOString(),
      });
    }
await rebuildAndApplyBadge(updated.actId, updated.dateISO);
    return res.status(200).send("<Response/>");
  } catch (err) {
    console.error("❌ Error in twilioInbound:", err);
    return res.status(200).send("<Response/>");
  }
}; 

// availabilityController.js (helpers)
async function rebuildAndApplyBadge(actId, dateISO) {
  try {
    if (!actId || !dateISO) return;
    const act = await Act.findById(actId).lean();
    if (!act) return;

    const badge = await buildAvailabilityBadgeFromRows(act, dateISO);

    if (badge) {
      await Act.updateOne(
        { _id: act._id },
        { $set: { availabilityBadge: { ...(act.availabilityBadge || {}), ...badge } } }
      );
    } else {
      // No active state → clear the badge
      await Act.updateOne(
        { _id: act._id },
        {
          $set: { "availabilityBadge.active": false },
          $unset: {
            "availabilityBadge.vocalistName": "",
            "availabilityBadge.inPromo": "",
            "availabilityBadge.isDeputy": "",
            "availabilityBadge.photoUrl": "",
            "availabilityBadge.musicianId": "",
            "availabilityBadge.dateISO": "",
            "availabilityBadge.address": "",
            "availabilityBadge.deputies": "",
            "availabilityBadge.setAt": "",
          },
        }
      );
    }
  } catch (e) {
    console.warn("⚠️ rebuildAndApplyBadge failed:", e?.message || e);
  }
}

// -------------------- Delivery/Read Receipts --------------------


// module-scope guard so we don't double-fallback on Twilio retries

export const twilioStatus = async (req, res) => {
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



function parsePayload(p = "") {
  const s = String(p).trim();
  if (!s) return { reply: null, enquiryId: null };
  // Matches: YES<enquiryId>  or  NO<enquiryId>
  const m = s.match(/^(YES|NO)([A-Za-z0-9_-]+)?$/i);
  if (!m) return { reply: null, enquiryId: null };
  return {
    reply: m[1].toUpperCase() === "YES" ? "yes" : "no",
    enquiryId: m[2] || null,
  };
}



const normalizeFrom = (from) => {
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
  let s = String(raw || "").trim().replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};


// POST /api/availability/rebuild-badge { actId, dateISO }
export const rebuildAvailabilityBadge = async (req, res) => {
  try {
    const { actId, dateISO } = req.body || {};
    if (!actId || !dateISO) {
      return res.status(400).json({ success: false, message: "Missing actId/dateISO" });
    }

    const act = await Act.findById(actId).lean();
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    // Build the suggested badge state (may include either single featured musician or deputies)
    let badge = await buildAvailabilityBadgeFromRows(act, dateISO);

    if (!badge) {
      await Act.updateOne(
        { _id: actId },
        {
          $set: { "availabilityBadge.active": false },
          $unset: {
            "availabilityBadge.deputies": "",
            "availabilityBadge.musicianId": "",
            "availabilityBadge.photoUrl": "",
            "availabilityBadge.vocalistName": "",
            "availabilityBadge.profileUrl": "",
            "availabilityBadge.setAt": "",
          },
        }
      );
      return res.json({ success: true, updated: false, reason: "No qualifying replies" });
    }

    // ---- Enrichment helpers (strict: only use Musician.profilePicture if it's a string URL) ----
    const pickProfilePicture = (doc) => {
      if (!doc) return "";
      const v = typeof doc.profilePicture === "string" ? doc.profilePicture.trim() : doc.profilePicture?.url;
      return v && typeof v === "string" && v.startsWith("http") ? v : "";
    };

    const ensureProfileForId = async (maybeId) => {
      if (!maybeId) return { profilePicture: "" };
      try {
        const m = await Musician.findById(maybeId).select("profilePicture").lean();
        return { profilePicture: pickProfilePicture(m) };
      } catch {
        return { profilePicture: "" };
      }
    };

    // Compute profileUrl (frontend also builds this, but we store for convenience)
    const buildProfileUrl = (id) => (id ? `/musician/${id}` : "");

    // If this is a single-person badge, make sure musicianId/profileUrl are present
    if (!badge.isDeputy) {
      if (badge.musicianId) {
        badge.profileUrl = badge.profileUrl || buildProfileUrl(badge.musicianId);
        // Optional: enrich photoUrl from profilePicture if photoUrl missing
        if (!badge.photoUrl) {
          const { profilePicture } = await ensureProfileForId(badge.musicianId);
          if (profilePicture) badge.photoUrl = profilePicture;
        }
      }
    }

    // If this is a deputies badge, normalise each deputy entry
    if (Array.isArray(badge.deputies) && badge.deputies.length) {
      const enriched = [];
      for (const d of badge.deputies) {
        const musId = d?.musicianId ? String(d.musicianId) : "";
        const base = {
          name: (d?.name || "").trim(),
          musicianId: musId,
          profileUrl: d?.profileUrl || buildProfileUrl(musId),
          setAt: d?.setAt || new Date(),
        };
        // Prefer an explicit d.profilePicture if valid; otherwise look it up by musicianId
        let profilePicture = typeof d?.profilePicture === "string" && d.profilePicture.startsWith("http")
          ? d.profilePicture
          : "";
        if (!profilePicture && musId) {
          const looked = await ensureProfileForId(musId);
          profilePicture = looked.profilePicture || "";
        }
        enriched.push({ ...base, profilePicture });
      }
      badge.deputies = enriched;
    }

    const $set = {
      "availabilityBadge.active": !!badge.active,
      "availabilityBadge.dateISO": badge.dateISO,
      "availabilityBadge.setAt": badge.setAt,
      "availabilityBadge.address": badge.address || "",
      "availabilityBadge.vocalistName": badge.vocalistName || "",
      "availabilityBadge.isDeputy": !!badge.isDeputy,
      "availabilityBadge.inPromo": !!badge.inPromo,
    };

    if (badge.photoUrl) $set["availabilityBadge.photoUrl"] = badge.photoUrl;

    // Persist top-level identity fields for featured person (when present)
    if (badge.musicianId) {
      $set["availabilityBadge.musicianId"] = badge.musicianId;
      $set["availabilityBadge.profileUrl"] = buildProfileUrl(badge.musicianId);
    } else {
      $set["availabilityBadge.musicianId"] = "";
      $set["availabilityBadge.profileUrl"] = "";
    }

    if (Array.isArray(badge.deputies)) {
      $set["availabilityBadge.deputies"] = badge.deputies;
    }

    await Act.updateOne({ _id: actId }, { $set });

    return res.json({ success: true, updated: true, badge });
  } catch (err) {
    console.error("rebuildAvailabilityBadge error:", err);
    return res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
};

// availabilityController.js (export this)
export async function pingDeputiesFor(actId, lineupId, dateISO, formattedAddress, duties) {
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