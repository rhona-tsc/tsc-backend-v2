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
import { normalize } from "../utils/phoneUtils.js";
import AvailabilityModel from "../models/availabilityModel.js";
import bookingBoardItem from "../models/bookingBoardItem.js";
import { updateOrCreateBookingEvent } from "../utils/updateOrCreateBookingEvent.js";
import Booking from "../models/bookingModel.js";

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

const formatWithOrdinal = (dateLike) => {
  const d = new Date(dateLike);
  if (isNaN(d)) return String(dateLike || "");
  const day = d.getDate();
  const j = day % 10, k = day % 100;
  const suffix = j === 1 && k !== 11 ? "st" : j === 2 && k !== 12 ? "nd" : j === 3 && k !== 13 ? "rd" : "th";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
};

const normalizePhone = (raw = "") => {
  let v = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

const buildBookingSMS = ({ firstName, formattedDate, formattedAddress, fee, duties, actName, requestId }) => {
  return `Hi ${firstName || "there"}, booking request for ${formattedDate} at ${formattedAddress} with ${actName}. Role: ${duties || "performance"}. Fee: £${sanitizeFee(fee) || "TBC"}. Reply YES (YESBOOK_${requestId}) or NO (NOBOOK_${requestId}). 🤍 TSC`;
};

const findRealMusicianForMember = async (member = {}) => {
  try {
    if (member?.musicianId) {
      const byId = await Musician.findById(member.musicianId)
        .select("_id firstName lastName email phone phoneNumber phoneNormalized")
        .lean();
      if (byId) return byId;
    }

    const phone = normalizePhone(member?.phoneNumber || member?.phone || "");
    if (phone) {
      const byPhone = await Musician.findOne({
        $or: [{ phoneNormalized: phone }, { phone: phone }, { phoneNumber: phone }],
      })
        .select("_id firstName lastName email phone phoneNumber phoneNormalized")
        .lean();
      if (byPhone) return byPhone;
    }

    const email = String(member?.email || member?.emailAddress || "").trim().toLowerCase();
    if (email) {
      const byEmail = await Musician.findOne({ email })
        .select("_id firstName lastName email phone phoneNumber phoneNormalized")
        .lean();
      if (byEmail) return byEmail;
    }
  } catch (err) {
    console.warn("⚠️ findRealMusicianForMember failed:", err?.message || err);
  }
  return null;
};

const buildMemberFee = ({ perMemberFee, member }) => {
  if (Number.isFinite(Number(perMemberFee)) && Number(perMemberFee) > 0) {
    return Math.ceil(Number(perMemberFee));
  }
  const memberFee = Number(member?.fee || 0);
  return Number.isFinite(memberFee) && memberFee > 0 ? Math.ceil(memberFee) : 0;
};

/* -------------------------------------------------------------------------- */
/*                        triggerBookingRequests (main)                       */
/* -------------------------------------------------------------------------- */
export const triggerBookingRequests = async (req, res) => {
  console.log(`🦚 (controllers/allocationController.js) triggerBookingRequests called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  try {
    const { actId, lineupId, dateISO, address, perMemberFee, bookingId, bookingRef, dryRun = false } = req.body;
    console.log("🧪 triggerBookingRequests mode", {
  dryRun,
  actId,
  lineupId,
  dateISO,
  bookingId,
  bookingRef,
});
    if (!actId || !dateISO || !address) {
      return res.status(400).json({ success: false, message: "Missing actId/dateISO/address" });
    }

    const act = await Act.findById(actId).lean();
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });

    // 1) Clear the availability badge immediately
   console.log("🟡 Skipping badge clear in triggerBookingRequests; badge structure is date-keyed or embedded");

    // 2) Ensure booking event exists
    const event = dryRun
      ? { id: `dryrun_${actId}_${dateISO}` }
      : (await ensureBookingEvent({ actId, dateISO, address })).event;

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

    const booking = bookingId || bookingRef
      ? await Booking.findOne({
          $or: [{ bookingId: bookingId || bookingRef }, { bookingRef: bookingId || bookingRef }],
        }).lean()
      : await Booking.findOne({
          act: actId,
          status: "confirmed",
          $or: [
            { date: { $gte: new Date(`${dateISO}T00:00:00.000Z`), $lte: new Date(`${dateISO}T23:59:59.999Z`) } },
            { eventDate: { $gte: new Date(`${dateISO}T00:00:00.000Z`), $lte: new Date(`${dateISO}T23:59:59.999Z`) } },
          ],
        })
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean();

    const resolvedBookingRef = booking?.bookingId || booking?.bookingRef || bookingId || bookingRef || null;

    for (const m of members) {
      const roleLower = String(m?.instrument || "").trim().toLowerCase();
      if (!roleLower || roleLower === "manager" || roleLower === "admin") {
        continue;
      }

      const realMusician = await findRealMusicianForMember(m);
      const rawPhone =
        realMusician?.phone ||
        realMusician?.phoneNumber ||
        m?.phoneNumber ||
        m?.phone ||
        "";

      const phone = normalizePhone(rawPhone);
      if (!phone) {
        console.warn("🦚 triggerBookingRequests skip: no phone for member", {
          name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          instrument: m.instrument || "",
        });
        continue;
      }

      const memberFee = buildMemberFee({ perMemberFee, member: m });
      const requestId = `${ts}_${Math.random().toString(36).slice(2, 7)}`;
      const formattedDate = new Date(dateISO).toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "short", year: "numeric"
      });

      const smsBody = buildBookingSMS({
        firstName: firstNameOf(realMusician || m),
        formattedDate,
        formattedAddress: address,
        fee: memberFee,
        duties: m.instrument || "performance",
        actName: act.tscName || act.name || "the band",
        requestId,
      });

      if (!dryRun) {
        await EnquiryMessage.create({
          actId,
          lineupId: lineup._id || lineup.lineupId || null,
          musicianId: realMusician?._id || m?.musicianId || m?._id || null,
          enquiryId: requestId,
          bookingRef: resolvedBookingRef,
          phone,
          duties: m.instrument || "",
          fee: memberFee ? String(memberFee) : undefined,
          formattedDate,
          formattedAddress: address,
          meta: {
            actName: act.tscName || act.name,
            MetaActId: String(actId),
            MetaISODate: dateISO,
            MetaAddress: address,
            kind: "booking",
            lineupId: String(lineup._id || lineup.lineupId || ""),
            bookingRef: resolvedBookingRef || "",
          },
          calendar: {
            eventId: event.id,
            calendarStatus: "needsAction",
            attendeeEmail: realMusician?.email || m?.email || m?.emailAddress || "",
          },
          deliveryStatus: "queued",
          status: "queued",
        });

        await AvailabilityModel.findOneAndUpdate(
          {
            actId,
            lineupId: lineup._id || lineup.lineupId || null,
            dateISO,
            phone,
          },
          {
            $setOnInsert: {
              actId,
              lineupId: lineup._id || lineup.lineupId || null,
              dateISO,
              phone,
              musicianId: realMusician?._id || m?.musicianId || m?._id || null,
              musicianName: `${realMusician?.firstName || m?.firstName || ""} ${realMusician?.lastName || m?.lastName || ""}`.trim(),
              musicianEmail: realMusician?.email || m?.email || m?.emailAddress || "",
              duties: m.instrument || "performance",
              fee: memberFee ? String(memberFee) : "",
              formattedDate,
              formattedAddress: address,
              reply: null,
              createdAt: new Date(),
            },
            $set: {
              updatedAt: new Date(),
              status: "sent",
              bookingId: resolvedBookingRef,
            },
          },
          { new: true, upsert: true }
        );
      }

      const wa = dryRun
        ? { sid: `dryrun_${requestId}` }
        : await sendWAOrSMS({
            to: phone,
            templateParams: {
              FirstName: firstNameOf(realMusician || m),
              FormattedDate: formattedDate,
              FormattedAddress: address,
              Fee: sanitizeFee(memberFee),
              Duties: m.instrument || "performance",
              ActName: act.tscName || act.name || "the band",
            },
            smsBody,
          });

      if (!dryRun) {
        await EnquiryMessage.updateOne(
          { enquiryId: requestId },
          {
            $set: {
              deliveryStatus: "sent",
              status: "sent",
              messageSid: wa?.sid || null,
            },
          }
        );

        await AvailabilityModel.updateOne(
          { actId, lineupId: lineup._id || lineup.lineupId || null, dateISO, phone },
          {
            $set: {
              messageSidOut: wa?.sid || null,
              outboundChannel: "whatsapp",
              outboundSentAt: new Date(),
              outboundMessage: smsBody,
              status: "sent",
            },
          }
        );
      }

      console.log(`🦚 triggerBookingRequests sent`, {
        name: `${realMusician?.firstName || m.firstName || ""} ${realMusician?.lastName || m.lastName || ""}`.trim(),
        phone,
        duties: m.instrument || "",
        bookingRef: resolvedBookingRef,
      });

      const line = `Booking invite sent to ${realMusician?.firstName || m.firstName || ""} ${realMusician?.lastName || m.lastName || ""} (${m.instrument || ""})`;
      if (!dryRun) {
        await appendLineToEventDescription({ eventId: event.id, line });
      }

      sent.push({
        name: `${realMusician?.firstName || m.firstName || ""} ${realMusician?.lastName || m.lastName || ""}`.trim(),
        phone,
        instrument: m.instrument || "",
        fee: memberFee,
        requestId,
        attendeeEmail: realMusician?.email || m?.email || m?.emailAddress || "",
        dryRun,
      });
    }

    return res.json({ success: true, eventId: event.id, sent, dryRun });
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
    let requestId = null;

    const bookingMatch =
      bodyText.match(/YESBOOK_(\S+)/i) ||
      bodyText.match(/NOBOOK_(\S+)/i) ||
      buttonPayload.match(/YESBOOK_(\S+)/i) ||
      buttonPayload.match(/NOBOOK_(\S+)/i);

    if (bookingMatch) {
      requestId = bookingMatch[1];
    }

    // ---------------------------------------------------------
    // 3️⃣ Fetch the pending EnquiryMessage row
    // ---------------------------------------------------------
    let msg = null;

    if (requestId) {
      msg = await EnquiryMessage.findOneAndUpdate(
        { enquiryId: requestId },
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
const booking = msg?.bookingRef
  ? await Booking.findOne({
      $or: [{ bookingId: msg.bookingRef }, { bookingRef: msg.bookingRef }]
    }).lean()
  : null;
  const eventId =
    msg?.calendar?.eventId ||
    booking?.calendarEventId ||
    (booking ? await updateOrCreateBookingEvent({ booking }) : null);

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
  await AvailabilityModel.findOneAndUpdate(
    {
      phone: msg.phone,
      actId: msg.actId,
      dateISO: msg.meta?.MetaISODate,
    },
    {
      $set: {
        reply: "yes",
        status: "accepted",
        updatedAt: new Date(),
        calendarEventId: eventId || null,
        bookingId: msg.bookingRef || null,
      },
      $setOnInsert: {
        lineupId: msg.lineupId || null,
        musicianId: msg.musicianId || null,
        duties: msg.duties || "performance",
        fee: msg.fee || "",
        formattedDate: msg.formattedDate || "",
        formattedAddress: msg.formattedAddress || "",
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

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
          $or: [
            { musicianId: msg.musicianId },
            { phone: msg.phone },
          ],
          dateISO: msg.meta?.MetaISODate,
        },
        {
          $set: {
            reply: "unavailable",
            status: "unavailable",
            updatedAt: new Date(),
            bookingId: msg.bookingRef || null,
          },
        }
      );

      await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

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

      await AvailabilityModel.findOneAndUpdate(
        {
          phone: msg.phone,
          actId: msg.actId,
          dateISO: msg.meta?.MetaISODate,
        },
        {
          $set: {
            reply: "no",
            status: "declined",
            updatedAt: new Date(),
            bookingId: msg.bookingRef || null,
          },
        },
        { upsert: true, new: true }
      );

      await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

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
      bookingRef: msg.bookingRef || null,
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
        bookingRef: msg.bookingRef || "",
      },
      calendar: {
        eventId: msg.calendar?.eventId,
        calendarStatus: "needsAction",
      },
      deliveryStatus: "queued",
      status: "queued",
    });

    await AvailabilityModel.findOneAndUpdate(
      {
        actId: msg.actId,
        lineupId: msg.lineupId,
        dateISO: msg.meta?.MetaISODate,
        phone,
      },
      {
        $setOnInsert: {
          actId: msg.actId,
          lineupId: msg.lineupId,
          dateISO: msg.meta?.MetaISODate,
          phone,
          musicianId: nextDep.musicianId || nextDep._id || null,
          duties: msg.duties || "performance",
          fee: msg.fee || "",
          formattedDate: msg.formattedDate || "",
          formattedAddress: msg.formattedAddress || "",
          createdAt: new Date(),
        },
        $set: {
          updatedAt: new Date(),
          status: "sent",
          bookingId: msg.bookingRef || null,
        },
      },
      { upsert: true, new: true }
    );

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

    await AvailabilityModel.updateOne(
      {
        actId: msg.actId,
        lineupId: msg.lineupId,
        dateISO: msg.meta?.MetaISODate,
        phone,
      },
      {
        $set: {
          messageSidOut: wa?.sid || null,
          outboundChannel: "whatsapp",
          outboundSentAt: new Date(),
          outboundMessage: smsBody,
          status: "sent",
        },
      }
    );

    // ---------------------------------------------------
    // 6. Mark previous message auto-escalated
    // ---------------------------------------------------
    await EnquiryMessage.updateOne(
      { _id: msg._id },
      { $set: { autoEscalatedAt: new Date() } }
    );

    await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

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