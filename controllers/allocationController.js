// backend/controllers/allocationController.js
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import { sendWhatsAppMessage, sendWAOrSMS, sendSMSMessage } from "../utils/twilioClient.js";
import {
  ensureBookingEvent,
  appendLineToEventDescription,
  addAttendeeToEvent,
} from "./googleController.js";
import AvailabilityModel from "../models/availabilityModel.js";
import bookingBoardItem from "../models/bookingBoardItem.js";
import { createSharedBookingEvent } from "../utils/createSharedBookingEvent.js";

/* -------------------------------------------------------------------------- */
/*                            Helper: firstNameOf                             */
/* -------------------------------------------------------------------------- */
const firstNameOf = (p) => {
  console.log(`🦚 (controllers/allocationController.js) firstNameOf called at`, new Date().toISOString(), { p });
  if (!p) return "there";
  if (typeof p === "string") {
    const parts = p.trim().split(/\s+/);
    return parts[0] || "there";
  }
  const direct = p.firstName || p.FirstName || p.first_name || p.firstname || p.givenName || p.given_name || "";
  if (direct && String(direct).trim()) return String(direct).trim().split(/\s+/)[0];
  const full = p.name || p.fullName || p.displayName || "";
  if (full && String(full).trim()) return String(full).trim().split(/\s+/)[0];
  return "there";
};

/* -------------------------------------------------------------------------- */
/*                               Helper: sanitizeFee                          */
/* -------------------------------------------------------------------------- */
export const sanitizeFee = (v) => {
  console.log(`🦚 (controllers/allocationController.js) sanitizeFee called at`, new Date().toISOString(), { v });
  const s = String(v ?? "").trim();
  if (!s) return "TBC";
  return s.replace(/[^\d.]/g, "");
};

/* -------------------------------------------------------------------------- */
/*                              Helper: normalizeFrom                         */
/* -------------------------------------------------------------------------- */
const normalizeFrom = (from) => {
  console.log(`🦚 (controllers/allocationController.js) normalizeFrom called at`, new Date().toISOString(), { from });
  const v = String(from || '').replace(/^whatsapp:/i, '').trim();
  if (!v) return [];
  const plus = v.startsWith('+') ? v : (v.startsWith('44') ? `+${v}` : v);
  const uk07 = plus.replace(/^\+44/, '0');
  const ukNoPlus = plus.replace(/^\+/, '');
  return Array.from(new Set([plus, uk07, ukNoPlus]));
};

/* -------------------------------------------------------------------------- */
/*                        triggerBookingRequests (main)                       */
/* -------------------------------------------------------------------------- */
export const triggerBookingRequests = async (req, res) => {
  console.log(`🦚 (controllers/allocationController.js) triggerBookingRequests called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  try {
    const { actId, lineupId, dateISO, address, perMemberFee } = req.body;
    if (!actId || !dateISO || !address) {
      return res.status(400).json({ success: false, message: "Missing actId/dateISO/address" });
    }

    const act = await Act.findById(actId).lean();
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    // 1) Clear the availability badge immediately
    await Act.findByIdAndUpdate(actId, {
      $set: { "availabilityBadges.active": false },
      $unset: {
        "availabilityBadges.vocalistName": "",
        "availabilityBadges.inPromo": "",
        "availabilityBadges.dateISO": "",
        "availabilityBadges.address": "",
        "availabilityBadges.setAt": "",
      },
    });

    // 2) Ensure booking event exists
    const { event } = await ensureBookingEvent({ actId, dateISO, address });

    // 3) Resolve lineup + members
    const allLineups = Array.isArray(act.lineups) ? act.lineups : [];
    const lineup = lineupId
      ? allLineups.find(l => (l._id?.toString?.() === String(lineupId)) || (String(l.lineupId) === String(lineupId)))
      : allLineups[0];

    if (!lineup) {
      return res.json({ success: false, message: "No lineup found for act" });
    }

    const members = Array.isArray(lineup.bandMembers) ? lineup.bandMembers : [];
    if (!members.length) {
      return res.json({ success: false, message: "No bandMembers in lineup" });
    }

    console.log(`🦚 triggerBookingRequests: sending to ${members.length} members`, {
      actName: act.tscName || act.name,
      lineupId: lineup._id || lineup.lineupId,
    });

    const ts = Date.now();
    const sent = [];

    for (const m of members) {
      let raw = String(m.phoneNumber || m.phone || "").replace(/\s+/g, "");
      if (!raw && (m.musicianId || m._id)) {
        try {
          const mus = await Musician.findById(m.musicianId || m._id)
            .select("phone phoneNumber firstName lastName email")
            .lean();
          raw = String(mus?.phone || mus?.phoneNumber || "").replace(/\s+/g, "");
        } catch {}
      }
      if (!raw) {
        console.warn("🦚 triggerBookingRequests skip: no phone for member", {
          name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          instrument: m.instrument || "",
        });
        continue;
      }

      const phone =
        raw.startsWith("+") ? raw :
        raw.startsWith("0") ? raw.replace(/^0/, "+44") :
        raw.startsWith("44") ? `+${raw}` : raw;

      const bookingId = `${ts}_${Math.random().toString(36).slice(2,7)}`;

      // Persist message
      await EnquiryMessage.create({
        actId,
        lineupId: lineup._id || lineup.lineupId || null,
        enquiryId: bookingId,
        phone,
        duties: m.instrument || "",
        fee: perMemberFee ? String(perMemberFee) : undefined,
        formattedDate: new Date(dateISO).toLocaleDateString("en-GB", {
          weekday: "long", day: "numeric", month: "short", year: "numeric"
        }),
        formattedAddress: address,
        meta: {
          actName: act.tscName || act.name,
          MetaActId: String(actId),
          MetaISODate: dateISO,
          MetaAddress: address,
          kind: "booking",
          lineupId: String(lineup._id || lineup.lineupId || ""),
        },
        calendar: { eventId: event.id, calendarStatus: "needsAction" },
      });

      await sendWAOrSMS({
        to: phone,
        templateParams: {
          FirstName: firstNameOf(m),
          FormattedDate: new Date(dateISO).toLocaleDateString("en-GB", {
            weekday: "long", day: "numeric", month: "short", year: "numeric"
          }),
          FormattedAddress: address,
          Fee: sanitizeFee(perMemberFee),
          Duties: m.instrument || "performance",
          ActName: act.tscName || act.name || "the band",
        },
        smsBody:
          `Hi ${firstNameOf(m)}, booking request for ` +
          `${new Date(dateISO).toLocaleDateString("en-GB", {
            weekday:"long", day:"numeric", month:"short", year:"numeric"
          })} ` +
          `at ${address} with ${act.tscName || act.name}. Role: ${m.instrument || "performance"}. ` +
          `Fee: £${String(perMemberFee ?? "").replace(/[^\d.]/g,"") || "TBC"}. ` +
          `Reply YES (YESBOOK_${bookingId}) or NO (NOBOOK_${bookingId}).`,
      });

      console.log(`🦚 triggerBookingRequests sent`, {
        name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
        phone,
        duties: m.instrument || "",
      });

      const line = `Booking invite sent to ${m.firstName || ""} ${m.lastName || ""} (${m.instrument || ""})`;
      await appendLineToEventDescription({ eventId: event.id, line });

      sent.push({ name: `${m.firstName || ""} ${m.lastName || ""}`.trim(), phone, instrument: m.instrument || "" });
    }

    return res.json({ success: true, eventId: event.id, sent });
  } catch (err) {
    console.error(`🦚 triggerBookingRequests error`, err);
    return res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
};

/* -------------------------------------------------------------------------- */
/*                              parseBookingPayload                           */
/* -------------------------------------------------------------------------- */
const parseBookingPayload = (payload) => {
  console.log(`🦚 (controllers/allocationController.js) parseBookingPayload called at`, new Date().toISOString(), { payload });
  const m = String(payload || '').trim().match(/^(YESBOOK|NOBOOK)_(.+)$/i);
  if (!m) return { reply: null, bookingId: null };
  const kind = m[1].toUpperCase();
  const bookingId = m[2];
  const reply = kind === "YESBOOK" ? "yes" : "no";
  return { reply, bookingId };
};

/* -------------------------------------------------------------------------- */
/*                            twilioInboundBooking                            */
/* -------------------------------------------------------------------------- */
export const twilioInboundBooking = async (req, res) => {
  console.log(`🦚 twilioInboundBooking v4 called`, {
    ts: new Date().toISOString(),
    body: req.body,
  });

  // ---------------------------------------------------------
  // Helper: interpret YES / NO / NOLOC
  // ---------------------------------------------------------
  function interpretReply(raw) {
    if (!raw) return null;
    const low = raw.toLowerCase().trim();

    if (low === "yes") return "YES";            // Yes, book me in
    if (low === "no") return "NO_BOOKED";       // I'm already booked
    if (low === "noloc" || low === "no loc") return "NO_LOC"; // No thanks (location)
    return null;
  }

  try {
    // ---------------------------------------------------------
    // Extract incoming fields from Twilio webhook
    // ---------------------------------------------------------
    const bodyText      = String(req.body?.Body || "");
    const buttonText    = String(req.body?.ButtonText || "");
    const buttonPayload = String(req.body?.ButtonPayload || "");
    const fromRaw       = String(req.body?.From || req.body?.WaId || "");

    console.log("🦚 inbound payload", {
      fromRaw,
      bodyText,
      buttonText,
      buttonPayload,
    });

    // ---------------------------------------------------------
    // 1️⃣ Determine musician reply type
    // ---------------------------------------------------------
    const rawReply = buttonPayload || buttonText || bodyText || "";
    const replyType = interpretReply(rawReply);

    console.log("🦚 replyType detected:", replyType);

    if (!replyType) {
      console.warn("⚠️ Could not interpret reply; ignoring");
      return res.status(200).send("<Response/>");
    }

    // ---------------------------------------------------------
    // 2️⃣ Extract bookingId from YESBOOK_xxx or NOBOOK_xxx
    // ---------------------------------------------------------
    let bookingId = null;

    const bookingMatch =
      bodyText.match(/YESBOOK_(\S+)/i) ||
      bodyText.match(/NOBOOK_(\S+)/i);

    if (bookingMatch) {
      bookingId = bookingMatch[1];
    }

    // ---------------------------------------------------------
    // 3️⃣ Fetch the pending EnquiryMessage row
    // ---------------------------------------------------------
    let msg = null;

    if (bookingId) {
      msg = await EnquiryMessage.findOneAndUpdate(
        { enquiryId: bookingId },
        {
          $set: {
            reply: replyType,
            repliedAt: new Date(),
            deliveryStatus: "read",
            status: "read",
            "calendar.calendarStatus": "needsAction",
          },
        },
        { new: true }
      );
    } else {
      // Fallback matching by phone (last unanswered request)
      const variants = normalizeFrom(fromRaw);

      msg = await EnquiryMessage.findOneAndUpdate(
        {
          phone: { $in: variants },
          "meta.kind": "booking",
          $or: [{ reply: null }, { reply: { $exists: false } }],
        },
        {
          $set: {
            reply: replyType,
            repliedAt: new Date(),
            deliveryStatus: "read",
            status: "read",
            "calendar.calendarStatus": "needsAction",
          },
        },
        { new: true }
      );
    }

    if (!msg) {
      console.warn("🦚 No matching EnquiryMessage found for this reply");
      return res.status(200).send("<Response/>");
    }

    console.log("🦚 matched EnquiryMessage:", msg._id);

    // ---------------------------------------------------------
    // 4️⃣ YES — ACCEPTED
    // ---------------------------------------------------------
  if (replyType === "YES") {
  console.log("🟢 YES — musician accepts the gig");

  // 👍 Ensure shared event exists
  const booking = await Booking.findOne({ bookingRef: msg.enquiryId }).lean();
  const eventId =
    booking?.calendarEventId ||
    (await createSharedBookingEvent({ booking }));

  // ✔ determine their email
  const phoneVariants = normalizeFrom(fromRaw);
  let email = msg.calendar?.attendeeEmail || null;

  if (!email) {
    const act = await Act.findById(msg.actId).lean();
    const lineup =
      (act.lineups || []).find(x => String(x._id) === String(msg.lineupId))
      || act.lineups[0];

    const members = lineup.bandMembers || [];
    const match = members.find(m =>
      normalizeFrom(m.phoneNumber || m.phone)
        .some(p => phoneVariants.includes(p))
    );

    email = match?.email || null;
  }

  // ✔ Add attendee to the shared event
  if (eventId && email) {
    await addAttendeeToEvent({ eventId, email });

    await EnquiryMessage.updateOne(
      { _id: msg._id },
      {
        $set: {
          "calendar.attendeeEmail": email,
          "calendar.eventId": eventId,
        }
      }
    );
  }

  // Mark musician YES
  await AvailabilityModel.updateOne(
    { phone: msg.phone, actId: msg.actId, dateISO: msg.meta?.MetaISODate },
    { $set: { reply: "yes", updatedAt: new Date() } }
  );

  return res.status(200).send("<Response/>");
}

    // ---------------------------------------------------------
    // 5️⃣ NO_BOOKED — I'm already booked elsewhere
    // ---------------------------------------------------------
    if (replyType === "NO_BOOKED") {
      console.log("🔴 NO_BOOKED — musician is unavailable globally for this date");

      // Mark unavailable for ALL acts on this date
      await AvailabilityModel.updateMany(
        {
          musicianId: msg.musicianId,
          dateISO: msg.meta?.MetaISODate,
        },
        {
          $set: {
            reply: "unavailable",
            updatedAt: new Date(),
          },
        }
      );

      // Escalate to deputy
      await escalateToNextDeputy(msg);

      return res.status(200).send("<Response/>");
    }

    // ---------------------------------------------------------
    // 6️⃣ NO_LOC — decline just this one enquiry
    // ---------------------------------------------------------
    if (replyType === "NO_LOC") {
      console.log("🟠 NO_LOC — decline this booking only");

      await EnquiryMessage.updateOne(
        { _id: msg._id },
        { $set: { reply: "no", updatedAt: new Date() } }
      );

      // Escalate to next deputy
      await escalateToNextDeputy(msg);

      return res.status(200).send("<Response/>");
    }

    return res.status(200).send("<Response/>");

  } catch (err) {
    console.error("❌ twilioInboundBooking v4 ERROR:", err);
    return res.status(200).send("<Response/>");
  }
};

export async function escalateToNextDeputy(msg) {
  try {
    console.log("🟡 escalateToNextDeputy v2 → starting", {
      msgId: msg._id,
      phone: msg.phone,
      actId: msg.actId,
      lineupId: msg.lineupId,
    });

    // ---------------------------------------------------
    // 1. Load act + lineup + members
    // ---------------------------------------------------
    const act = await Act.findById(msg.actId).lean();
    if (!act) {
      console.warn("❗ escalateToNextDeputy: act missing");
      return false;
    }

    const lineup =
      act.lineups?.find(
        (l) =>
          String(l._id) === String(msg.lineupId) ||
          String(l.lineupId) === String(msg.lineupId)
      ) || act.lineups?.[0];

    if (!lineup) {
      console.warn("❗ escalateToNextDeputy: lineup missing");
      return false;
    }

    const members = lineup.bandMembers || [];

    // Identify the current musician in the lineup
    const current = members.find((m) => {
      const phones = normalizeFrom(m.phoneNumber || m.phone);
      return phones.includes(msg.phone);
    });

    if (!current) {
      console.warn("❗ escalateToNextDeputy: could not match current musician by phone");
      return false;
    }

    const deputies = current.deputies || [];
    if (!deputies.length) {
      console.log("ℹ️ No deputies — stopping escalation");
      return false;
    }

    // ---------------------------------------------------
    // 2. Find the FIRST deputy who hasn’t been contacted yet
    // ---------------------------------------------------
    const contactedPhones = await EnquiryMessage.distinct("phone", {
      actId: msg.actId,
      lineupId: msg.lineupId,
      "meta.MetaISODate": msg.meta?.MetaISODate,
    });

    let nextDep = deputies.find((d) => {
      const raw = (d.phoneNumber || d.phone || "").replace(/\s+/g, "");
      const norm =
        raw.startsWith("+") ? raw :
        raw.startsWith("0") ? raw.replace(/^0/, "+44") :
        raw.startsWith("44") ? `+${raw}` : `+${raw}`;

      return !contactedPhones.includes(norm);
    });

    if (!nextDep) {
      console.log("ℹ️ All deputies have already been contacted. Stopping.");
      return false;
    }

    // ---------------------------------------------------
    // 3. Format deputy phone
    // ---------------------------------------------------
    let raw = (nextDep.phoneNumber || nextDep.phone || "").replace(/\s+/g, "");
    let phone =
      raw.startsWith("+") ? raw :
      raw.startsWith("0") ? raw.replace(/^0/, "+44") :
      raw.startsWith("44") ? `+${raw}` : `+${raw}`;

    // ---------------------------------------------------
    // 4. Create new EnquiryMessage for this deputy
    // ---------------------------------------------------
    const newBookingId = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const created = await EnquiryMessage.create({
      actId: msg.actId,
      lineupId: msg.lineupId,
      musicianId: nextDep.musicianId || nextDep._id || null,
      enquiryId: newBookingId,
      phone,
      duties: msg.duties,
      fee: msg.fee,
      formattedDate: msg.formattedDate,
      formattedAddress: msg.formattedAddress,
      meta: {
        actName: msg.meta?.actName,
        MetaActId: msg.meta?.MetaActId,
        MetaISODate: msg.meta?.MetaISODate,
        MetaAddress: msg.meta?.MetaAddress,
        kind: "booking",
      },
      calendar: {
        eventId: msg.calendar?.eventId,
        calendarStatus: "needsAction",
      },
      deliveryStatus: "queued",
      status: "queued",
    });

    console.log("🟢 Created new deputy EnquiryMessage", {
      messageId: created._id,
      phone,
    });

    // ---------------------------------------------------
    // 5. Send WhatsApp booking request
    // ---------------------------------------------------
    const smsBody =
      `Hi ${firstNameOf(nextDep)}, ${msg.formattedDate} in ${msg.formattedAddress} ` +
      `with ${msg.meta?.actName || "the band"} for ${msg.duties || "performance"} ` +
      `at £${sanitizeFee(msg.fee)}. Reply YES or NO. 🤍 TSC`;

    const wa = await sendWhatsAppMessage({
      to: `whatsapp:${phone}`,
      contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
      variables: {
        "1": firstNameOf(nextDep),
        "2": msg.formattedDate,
        "3": msg.formattedAddress,
        "4": sanitizeFee(msg.fee),
        "5": msg.duties || "performance",
        "6": msg.meta?.actName || "the band",
      },
      smsBody,
    });

    await EnquiryMessage.updateOne(
      { _id: created._id },
      { $set: { messageSid: wa?.sid || null, deliveryStatus: "sent" } }
    );

    // ---------------------------------------------------
    // 6. Mark previous message auto-escalated
    // ---------------------------------------------------
    await EnquiryMessage.updateOne(
      { _id: msg._id },
      { $set: { autoEscalatedAt: new Date() } }
    );

    console.log("🟢 Escalation complete → new deputy contacted");
    return true;

  } catch (err) {
    console.error("❌ escalateToNextDeputy v2 ERROR:", err);
    return false;
  }
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

    await bookingBoardItem.updateMany(
      { actId, eventDateISO: dateISO },
      { $set: { allocation: { status, lastCheckedAt: new Date() } } }
    );
  } catch (e) {
    console.warn("⚠️ refreshAllocationForActDate failed:", e?.message || e);
  }
}