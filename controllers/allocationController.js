import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import {
  ensureBookingEvent,
  appendLineToEventDescription,
} from "./googleController.js";
import { addAttendeeToEvent } from "./googleController.js";
import { sendWAOrSMS } from "../utils/twilioClient.js";

// Extract a friendly first name from various shapes
const firstNameOf = (p) => {
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


// normalize a phone variants (same helper you used elsewhere)
// Ensure a clean numeric-esque value for Twilio var {{6}}
const sanitizeFee = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return "TBC";
  return s.replace(/[^\d.]/g, "");
};
const normalizeFrom = (from) => {
  const v = String(from || '').replace(/^whatsapp:/i, '').trim();
  if (!v) return [];
  const plus = v.startsWith('+') ? v : (v.startsWith('44') ? `+${v}` : v);
  const uk07 = plus.replace(/^\+44/, '0');
  const ukNoPlus = plus.replace(/^\+/, '');
  return Array.from(new Set([plus, uk07, ukNoPlus]));
};

export const triggerBookingRequests = async (req, res) => {
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

    // 2) Ensure a single booking event exists for this act/day
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

    // 4) Send booking requests to all members in this lineup
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
        console.warn("[triggerBookingRequests] skip: no phone for member", {
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

      // Persist a tracking row in EnquiryMessage (reuse model; mark it as booking via meta)
      await EnquiryMessage.create({
        actId,
        lineupId: lineup._id || lineup.lineupId || null,
        musicianId: null, // optional—if you have musician doc id, set it
        enquiryId: bookingId,
        phone,
        duties: m.instrument || "",
        fee: perMemberFee ? String(perMemberFee) : undefined,
        formattedDate: new Date(dateISO).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" }),
        formattedAddress: address,
        meta: {
          actName: act.tscName || act.name,
          MetaActId: String(actId),
          MetaISODate: dateISO,
          MetaAddress: address,
          kind: "booking",
          lineupId: String(lineup._id || lineup.lineupId || ""),
        },
        calendar: {
          eventId: event.id,
          calendarStatus: "needsAction",
        },
      });

      // Send WhatsApp or SMS booking request
     await sendWAOrSMS({
  to: phone,
  templateParams: {
    FirstName: firstNameOf(m), // {{1}}
    FormattedDate: new Date(dateISO).toLocaleDateString(
      "en-GB",
      { weekday: "long", day: "numeric", month: "short", year: "numeric" }
    ),                         // {{2}}
    FormattedAddress: address, // {{3}}
    Fee: sanitizeFee(perMemberFee),        // {{4}} (digits only)
    Duties: m.instrument || "performance", // {{5}}
    ActName: act.tscName || act.name || "the band", // {{6}}
  },
  // Fallback SMS with payloads included:
  smsBody:
    `Hi ${firstNameOf(m)}, booking request for ` +
    `${new Date(dateISO).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"short", year:"numeric" })} ` +
    `at ${address} with ${act.tscName || act.name}. Role: ${m.instrument || "performance"}. ` +
    `Fee: £${String(perMemberFee ?? "").replace(/[^\d.]/g,"") || "TBC"}. ` +
    `Reply YES (${`YESBOOK_${bookingId}`}) or NO (${`NOBOOK_${bookingId}`}).`,
});
      console.log("[triggerBookingRequests] ✓ WA sent", {
        to: phone,
        name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
        duties: m.instrument || "",
      });

      // Add a line to event description (one line per member invite)
      const line = `Booking invite sent to ${m.firstName || ""} ${m.lastName || ""} (${m.instrument || ""})`;
      await appendLineToEventDescription({ eventId: event.id, line });

      sent.push({ name: `${m.firstName || ""} ${m.lastName || ""}`.trim(), phone, instrument: m.instrument || "" });
    }

    return res.json({ success: true, eventId: event.id, sent });
  } catch (err) {
    console.error("❌ triggerBookingRequests error:", err);
    return res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
};

/** Parse YESBOOK_<id> | NOBOOK_<id> */
const parseBookingPayload = (payload) => {
  const m = String(payload || '').trim().match(/^(YESBOOK|NOBOOK)_(.+)$/i);
  if (!m) return { reply: null, bookingId: null };
  const kind = m[1].toUpperCase();
  const bookingId = m[2];
  const reply = kind === "YESBOOK" ? "yes" : "no";
  return { reply, bookingId };
};

export const twilioInboundBooking = async (req, res) => {
  try {
    const bodyText     = String(req.body?.Body || "");
    const buttonText   = String(req.body?.ButtonText || "");
    const buttonPayload= String(req.body?.ButtonPayload || "");
    const inboundSid   = String(req.body?.MessageSid || "");
    const fromRaw      = String(req.body?.From || req.body?.WaId || "");

    console.log("📩 Booking inbound webhook:", {
      From: fromRaw, Body: bodyText, ButtonText: buttonText, ButtonPayload: buttonPayload, MessageSid: inboundSid
    });

    // 1) Get bookingId + reply
    let { reply, bookingId } = parseBookingPayload(buttonPayload);
    if (!reply) {
      const low = (buttonText || bodyText).toLowerCase();
      if (low.includes("yes")) reply = "yes";
      else if (low.includes("no")) reply = "no";
    }
    if (!bookingId) {
      // Try to detect bookingId from free text if you ever include it in the copy
      const m = (bodyText.match(/YESBOOK_(\S+)/i) || bodyText.match(/NOBOOK_(\S+)/i));
      if (m) bookingId = m[1];
    }

    let msg = null;
    if (!bookingId) {
      // Fallback: correlate by phone → most recent pending booking message
      const variants = normalizeFrom(fromRaw);
      msg = await EnquiryMessage.findOne({
        phone: { $in: variants },
        "meta.kind": "booking",
        $or: [{ reply: null }, { reply: { $exists: false } }],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      if (!msg) {
        console.warn("⚠️ No bookingId and no pending message matched by phone; ignoring");
        return res.status(200).send("<Response/>");
      }

      // Update reply on that message
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
      // 2) Load the booking message row (EnquiryMessage with meta.kind=booking)
      msg = await EnquiryMessage.findOneAndUpdate(
        { enquiryId: bookingId },
        {
          $set: {
            reply: reply || "yes",
            repliedAt: new Date(),
            status: "read",
            "calendar.calendarStatus": "needsAction", // unchanged here
          },
        },
        { new: true }
      );

      if (!msg) {
        console.warn("⚠️ Booking message not found for", bookingId);
        return res.status(200).send("<Response/>");
      }
    }

    // 3) YES → add attendee to booking event
    if (reply === "yes") {
      // Resolve email for this phone
      const phoneVariants = normalizeFrom(fromRaw);
      let email = msg.calendar?.attendeeEmail || null;
      if (!email) {
        // Try to match against act lineup members
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
        await EnquiryMessage.updateOne(
          { _id: msg._id },
          { $set: { "calendar.attendeeEmail": email } }
        );
        console.log("👥 Added attendee to booking event:", email);
      } else {
        console.warn("⚠️ Missing eventId or email; cannot add attendee", { eventId, email });
      }
    }

    // 4) NO → escalate to deputy (if present in lineup)
    if (reply === "no") {
      const act = await Act.findById(msg.actId).lean();
      const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
      const l = lineups.find(x =>
        (x._id?.toString?.() === String(msg.lineupId)) || (String(x.lineupId) === String(msg.lineupId))
      ) || lineups[0];

      const members = Array.isArray(l?.bandMembers) ? l.bandMembers : [];
      // Find the current member by phone
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
          musicianId: null,
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
   `with ${msg.meta?.actName || "the band"} for ${current?.instrument || "performance"} ` +   `at £${sanitizeFee(msg.fee)}. Reply YES or NO. 🤍 TSC`;
    await sendWhatsAppMessage({
   to: phone,
   // if you have a specific template for this flow, set contentSid: process.env.TWILIO_..., else omit to use default
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

        console.log("➡️ Escalated booking request to deputy:", {
          name: `${nextDep.firstName || ""} ${nextDep.lastName || ""}`.trim(), phone
        });
      } else {
        console.log("ℹ️ No deputy configured; stopping escalation.");
      }
    }

    return res.status(200).send("<Response/>");
  } catch (err) {
    console.error("❌ Error in twilioInboundBooking:", err);
    return res.status(200).send("<Response/>");
  }
};