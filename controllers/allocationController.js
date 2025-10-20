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
const sanitizeFee = (v) => {
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
  console.log(`🦚 (controllers/allocationController.js) twilioInboundBooking called at`, new Date().toISOString(), {
    body: req.body,
  });
  try {
    const bodyText = String(req.body?.Body || "");
    const buttonText = String(req.body?.ButtonText || "");
    const buttonPayload = String(req.body?.ButtonPayload || "");
    const inboundSid = String(req.body?.MessageSid || "");
    const fromRaw = String(req.body?.From || req.body?.WaId || "");

    console.log(`🦚 twilioInboundBooking inbound`, {
      From: fromRaw, Body: bodyText, ButtonText: buttonText, ButtonPayload: buttonPayload, MessageSid: inboundSid,
    });

    let { reply, bookingId } = parseBookingPayload(buttonPayload);
    if (!reply) {
      const low = (buttonText || bodyText).toLowerCase();
      if (low.includes("yes")) reply = "yes";
      else if (low.includes("no")) reply = "no";
    }
    if (!bookingId) {
      const m = (bodyText.match(/YESBOOK_(\S+)/i) || bodyText.match(/NOBOOK_(\S+)/i));
      if (m) bookingId = m[1];
    }

    let msg = null;
    if (!bookingId) {
      const variants = normalizeFrom(fromRaw);
      msg = await EnquiryMessage.findOne({
        phone: { $in: variants },
        "meta.kind": "booking",
        $or: [{ reply: null }, { reply: { $exists: false } }],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      if (!msg) {
        console.warn("🦚 No bookingId and no pending message matched by phone");
        return res.status(200).send("<Response/>");
      }

      await EnquiryMessage.updateOne(
        { _id: msg._id },
        {
          $set: {
            reply: reply || "yes",
            repliedAt: new Date(),
            status: "read",
            "calendar.calendarStatus": "needsAction",
          },
        }
      );
    } else {
      msg = await EnquiryMessage.findOneAndUpdate(
        { enquiryId: bookingId },
        {
          $set: {
            reply: reply || "yes",
            repliedAt: new Date(),
            status: "read",
            "calendar.calendarStatus": "needsAction",
          },
        },
        { new: true }
      );

      if (!msg) {
        console.warn("🦚 Booking message not found", { bookingId });
        return res.status(200).send("<Response/>");
      }
    }

    if (reply === "yes") {
      console.log("🦚 twilioInboundBooking YES branch");
      const phoneVariants = normalizeFrom(fromRaw);
      let email = msg.calendar?.attendeeEmail || null;

      if (!email) {
        const act = await Act.findById(msg.actId).lean();
        const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
        const l = lineups.find(x =>
          (x._id?.toString?.() === String(msg.lineupId)) || (String(x.lineupId) === String(msg.lineupId))
        ) || lineups[0];
        const members = Array.isArray(l?.bandMembers) ? l.bandMembers : [];
        const match = members.find(m => {
          const mPhones = normalizeFrom(m.phoneNumber || m.phone);
          return mPhones.some(p => phoneVariants.includes(p));
        });
        email = match?.email || null;
      }

      const eventId = msg.calendar?.eventId;
      if (eventId && email) {
        await addAttendeeToEvent({ eventId, email });
        await EnquiryMessage.updateOne({ _id: msg._id }, { $set: { "calendar.attendeeEmail": email } });
        console.log("🦚 Added attendee to booking event", { email });
      } else {
        console.warn("🦚 Missing eventId or email for YES branch", { eventId, email });
      }
    }

    if (reply === "no") {
      console.log("🦚 twilioInboundBooking NO branch");
      const act = await Act.findById(msg.actId).lean();
      const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
      const l = lineups.find(x =>
        (x._id?.toString?.() === String(msg.lineupId)) || (String(x.lineupId) === String(msg.lineupId))
      ) || lineups[0];
      const members = Array.isArray(l?.bandMembers) ? l.bandMembers : [];
      const current = members.find(m => {
        const mPhones = normalizeFrom(m.phoneNumber || m.phone);
        return mPhones.some(p => normalizeFrom(msg.phone).includes(p));
      });
      const deputies = Array.isArray(current?.deputies) ? current.deputies : [];
      const nextDep = deputies.find(d => d.phoneNumber || d.phone);

      if (nextDep) {
        const raw = (nextDep.phoneNumber || nextDep.phone).replace(/\s+/g, "");
        const phone =
          raw.startsWith("+") ? raw :
          raw.startsWith("0") ? raw.replace(/^0/, "+44") :
          raw.startsWith("44") ? `+${raw}` : raw;

        const newBookingId = `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

        await EnquiryMessage.create({
          actId: msg.actId,
          lineupId: msg.lineupId,
          enquiryId: newBookingId,
          phone,
          duties: current?.instrument || "",
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
        });

        const smsBody =
          `Hi ${firstNameOf(nextDep)}, ${msg.formattedDate} in ${msg.formattedAddress} ` +
          `with ${msg.meta?.actName || "the band"} for ${current?.instrument || "performance"} ` +
          `at £${sanitizeFee(msg.fee)}. Reply YES or NO. 🤍 TSC`;

        await sendWhatsAppMessage({
          to: phone,
          templateParams: {
            FirstName: firstNameOf(nextDep),
            FormattedDate: msg.formattedDate,
            FormattedAddress: msg.formattedAddress,
            Fee: sanitizeFee(msg.fee),
            Duties: current?.instrument || "performance",
            ActName: msg.meta?.actName || "the band",
          },
          smsBody,
        });

        console.log("🦚 Escalated booking to deputy", {
          name: `${nextDep.firstName || ""} ${nextDep.lastName || ""}`.trim(),
          phone,
        });
      } else {
        console.log("🦚 No deputy found; stopping escalation");
      }
    }

    return res.status(200).send("<Response/>");
  } catch (err) {
    console.error(`🦚 twilioInboundBooking error`, err);
    return res.status(200).send("<Response/>");
  }
};


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