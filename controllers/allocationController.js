// backend/controllers/allocationController.js
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import { sendWhatsAppMessage, sendWAOrSMS } from "../utils/twilioClient.js";
import {
  ensureBookingEvent,
  appendLineToEventDescription,
  addAttendeeToEvent,
} from "./googleController.js";

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
      $set: { "availabilityBadge.active": false },
      $unset: {
        "availabilityBadge.vocalistName": "",
        "availabilityBadge.inPromo": "",
        "availabilityBadge.dateISO": "",
        "availabilityBadge.address": "",
        "availabilityBadge.setAt": "",
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