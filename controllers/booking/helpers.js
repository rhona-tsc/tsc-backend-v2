import Musician from "../../models/musicianModel.js";
import Act from "../../models/actModel.js";
import AvailabilityModel from "../../models/availabilityModel.js";
import { sendWhatsAppMessage } from "../../utils/twilioClient.js";
import { normalize } from "../../utils/phoneUtils.js";

const LEAD_VOX_ROLES = [
  "lead vocal",
  "lead vocalist",
  "male lead vocal",
  "female lead vocal",
  "vocalist-guitarist",
  "vocalist / guitarist",
  "vocalist",
];

export async function sendBookingConfirmationToLeadVocalist(booking) {
  console.log("🎤 sendBookingConfirmationToLeadVocalist START", {
    bookingId: booking.bookingId,
  });

  const act = await Act.findById(booking.act).lean();
  if (!act) {
    console.warn("❌ No act found for booking", booking.act);
    return;
  }

  const lineup = act.lineups?.find(
    (l) =>
      String(l._id) === String(booking.lineupId) ||
      String(l.lineupId) === String(booking.lineupId)
  );

  if (!lineup) {
    console.warn("❌ No matching lineup for booking");
    return;
  }

  const members = lineup.bandMembers || [];

  // 1️⃣ Find lead vocalist
  const lead = members.find((m) =>
    LEAD_VOX_ROLES.includes(String(m.instrument || "").toLowerCase())
  );

  if (!lead) {
    console.warn("❌ No lead vocalist found in lineup");
    return;
  }

  // 2️⃣ Load musician doc (for email + full phone)
  const musician = await Musician.findById(lead.musicianId).lean();
  if (!musician) {
    console.warn("❌ Lead vocalist musician record not found");
    return;
  }

  const phone = normalize(musician.phone || musician.phoneNumber);
  if (!phone) {
    console.warn("❌ Lead vocalist has no valid phone");
    return;
  }

  // 3️⃣ Send WhatsApp using your Twilio template
  try {
    await sendWhatsAppMessage({
      to: phone,
      contentSid: process.env.TWILIO_BOOKING_CONFIRMATION_SID,
      allowDefaultContentSid: false,
      variables: {
        1: musician.firstName || "Musician",
        2: new Date(booking.date).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        3: booking.venueAddress || "Venue",
        4: booking.totalFee?.toFixed(2) || "0.00",
        5: "performance",
        6: booking.actName || "The Band",
      },
      allowSmsFallback: false,
      source: "lead-vocalist-booking-confirmation",
      requireOpportunityDetails: true,
      opportunityDetails: {
        actName: booking.actName,
        date: booking.date,
        address: booking.venueAddress,
        duties: "performance",
        fee: booking.totalFee,
      },
    });

    console.log("🎤 WA sent to lead vocalist:", phone);
  } catch (err) {
    console.error("❌ Failed to send WA to lead vocalist:", err.message);
  }

  // 4️⃣ Mark lead vocalist unavailable for that date
  const dateISO = new Date(booking.date).toISOString().slice(0, 10);

  await AvailabilityModel.findOneAndUpdate(
    { musicianId: musician._id, dateISO },
    {
      $set: {
        musicianId: musician._id,
        dateISO,
        actId: act._id,
        reply: "yes",
        source: "booking-confirmed",
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  console.log("🟣 Lead vocalist marked unavailable for", dateISO);

  // 5️⃣ Remove availability badge across ALL acts where this musician appears
  await Act.updateMany(
    {
      $or: [
        { "availabilityBadges.vocalistId": musician._id },
        { "availabilityBadges.featuredVocalistId": musician._id },
        { "availabilityBadges.prominentVocalistId": musician._id },
      ],
    },
    {
      $set: { "availabilityBadges.active": false },
      $unset: {
        "availabilityBadges.vocalistId": "",
        "availabilityBadges.vocalistName": "",
        "availabilityBadges.dateISO": "",
        "availabilityBadges.address": "",
        "availabilityBadges.inPromo": "",
        "availabilityBadges.setAt": "",
      },
    }
  );

  console.log("🧹 Cleared availability badges for this vocalist");
}



export async function sendBookingRequestsToLineup(booking) {
  console.log("🎸 sendBookingRequestsToLineup START", {
    bookingId: booking.bookingId,
  });

  const act = await Act.findById(booking.act).lean();
  if (!act) {
    console.warn("❌ No act for booking", booking.act);
    return;
  }

  const lineup = act.lineups?.find(
    (l) =>
      String(l._id) === String(booking.lineupId) ||
      String(l.lineupId) === String(booking.lineupId)
  );

  if (!lineup) {
    console.warn("❌ No lineup found for booking");
    return;
  }

  const members = lineup.bandMembers || [];

  // 1️⃣ Filter out lead vocalist (already handled in Chunk 1)
  const nonVocalists = members.filter(
    (m) => !LEAD_VOX_ROLES.includes(String(m.instrument || "").toLowerCase())
  );

  const dateISO = new Date(booking.date).toISOString().slice(0, 10);
  const formattedDate = new Date(booking.date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const address = booking.venueAddress || booking.venue || "";

  let sent = 0;

  for (const m of nonVocalists) {
    // 2️⃣ Load full musician data
    const musician = await Musician.findById(m.musicianId).lean();
    if (!musician) continue;

    const phone = normalize(musician.phone || musician.phoneNumber);
    if (!phone) continue;

    const feeUsed = Number(m.feeUsed || booking.feePerMember || 0);

    // WhatsApp variables for your template
    const variables = {
      1: musician.firstName || musician.name || "",
      2: formattedDate,
      3: address,
      4: String(feeUsed),
      5: m.instrument || "performance",
      6: booking.actName || act.tscName || act.name,
    };

    try {
      // 3️⃣ Send WhatsApp
      const waRes = await sendWhatsAppMessage({
        to: phone,
        contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
        allowDefaultContentSid: false,
        variables,
        allowSmsFallback: false,
        source: "booking-member-request",
        requireOpportunityDetails: true,
        opportunityDetails: {
          actName: booking.actName || act.tscName || act.name,
          date: formattedDate,
          address,
          duties: m.instrument,
          fee: feeUsed,
        },
      });

      // 4️⃣ Create/Update availability row
      await AvailabilityModel.findOneAndUpdate(
        {
          actId: act._id,
          musicianId: musician._id,
          dateISO,
        },
        {
          $set: {
            actId: act._id,
            musicianId: musician._id,
            dateISO,
            duties: m.instrument || "",
            fee: String(feeUsed),
            formattedDate,
            formattedAddress: address,
            actName: booking.actName || act.tscName || act.name,
            contactName: musician.firstName || "",
            reply: null, // waiting for YES / NO reply
            messageSidOut: waRes?.sid || null,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      console.log("📣 Booking request sent", {
        to: phone,
        duties: m.instrument,
      });

      sent++;
    } catch (err) {
      console.warn("⚠️ Booking-request WA failed", {
        phone,
        err: err.message,
      });
    }
  }

  console.log("🎸 sendBookingRequestsToLineup FINISHED", {
    totalSent: sent,
  });

  return sent;
}
