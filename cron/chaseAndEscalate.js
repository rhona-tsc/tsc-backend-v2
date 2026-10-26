// cron/chaseAndEscalate.js
import EnquiryMessage from "../models/EnquiryMessage.js";
import Musician from "../models/musicianModel.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import {
  escalateToNextDeputy,
  reconcilePendingRoleOffer,
  sanitizeFee,
} from "../controllers/allocationController.js";

const firstNameFor = async (msg) => {
  const musician = msg.musicianId
    ? await Musician.findById(msg.musicianId).select("firstName basicInfo.firstName").lean()
    : null;
  return musician?.firstName || musician?.basicInfo?.firstName || "there";
};

const AVAILABILITY_REMINDER_SID = String(
  process.env.TWILIO_AVAILABILITY_REMINDER_SID ||
    "HXfda06289224c64c8821b3fb5425bf53b",
).trim();

const AVAILABILITY_FINAL_REMINDER_SID = String(
  process.env.TWILIO_AVAILABILITY_FINAL_REMINDER_SID ||
    "HXa063207c0b9e26192622293604b6dac3",
).trim();

const failureEmailFor = ({ firstName, actName, date, phone, reminderLabel }) => ({
  to: String(
    process.env.WHATSAPP_FAILURE_EMAIL ||
      process.env.ALLOCATION_FAILURE_EMAIL ||
      process.env.ADMIN_EMAIL ||
      "rhona@thesupremecollective.co.uk",
  ).trim(),
  subject: `WhatsApp ${reminderLabel} failed: ${firstName} — ${actName}`,
  text: [
    `The ${reminderLabel} WhatsApp could not be delivered. No SMS fallback was sent.`,
    `Musician: ${firstName}`,
    `Act: ${actName}`,
    `Date: ${date}`,
    `Phone: ${phone}`,
  ].join("\n"),
});

const sendRepeatRequest = async ({ msg, firstName }) => {
  const smsBody =
    `Hi ${firstName}, just following up from the above. Booking request for ` +
    `${msg.formattedDate || msg.meta?.MetaISODate} at ` +
    `${msg.formattedAddress || msg.meta?.MetaAddress} with ${msg.meta?.actName || "the band"}. ` +
    `Role: ${msg.duties || "performance"}. Fee: £${sanitizeFee(msg.fee)}. ` +
    `Reply YES (YESBOOK_${msg.enquiryId}) or NO (NOBOOK_${msg.enquiryId}). 🤍 TSC`;

  await sendWhatsAppMessage({
    to: String(msg.phone).startsWith("whatsapp:") ? msg.phone : `whatsapp:${msg.phone}`,
    contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
    allowDefaultContentSid: false,
    requestId: msg.enquiryId,
    variables: {
      "1": firstName,
      "2": msg.formattedDate || msg.meta?.MetaISODate,
      "3": msg.formattedAddress || msg.meta?.MetaAddress,
      "4": sanitizeFee(msg.fee),
      "5": msg.duties || "performance",
      "6": msg.meta?.actName || "the band",
      "7": msg.enquiryId,
    },
    smsBody,
    allowSmsFallback: false,
    source: "booking-request-reminder",
    requireOpportunityDetails: true,
    opportunityDetails: {
      actName: msg.meta?.actName,
      date: msg.formattedDate || msg.meta?.MetaISODate,
      address: msg.formattedAddress || msg.meta?.MetaAddress,
      duties: msg.duties,
      fee: msg.fee,
    },
    failureEmail: failureEmailFor({
      firstName,
      actName: msg.meta?.actName || "booking",
      date: msg.formattedDate || msg.meta?.MetaISODate || "Not recorded",
      phone: msg.phone,
      reminderLabel: "booking reminder",
    }),
  });
};

const sendAvailabilityReminder = async ({ row, final = false }) => {
  const firstName = String(row.contactName || row.musicianName || "").trim().split(/\s+/)[0];
  const actName = String(row.actName || "").trim();
  const date = String(row.formattedDate || row.dateISO || "").trim();
  const address = String(row.formattedAddress || "").trim();
  const duties = String(row.duties || "").trim();
  const fee = String(row.fee || "").replace(/[^0-9.]/g, "");
  const requestId = String(row.requestId || row.enquiryId || "").trim();
  const reminderLabel = final ? "final availability reminder" : "availability reminder";

  await sendWhatsAppMessage({
    to: row.phone,
    contentSid: final ? AVAILABILITY_FINAL_REMINDER_SID : AVAILABILITY_REMINDER_SID,
    allowDefaultContentSid: false,
    requestId,
    variables: {
      "1": firstName,
      "2": actName,
      "3": date,
      "4": address,
      "5": fee,
      "6": duties,
      "7": requestId,
    },
    smsBody: "",
    allowSmsFallback: false,
    source: final ? "availability-final-reminder" : "availability-reminder",
    requireOpportunityDetails: true,
    opportunityDetails: { actName, date, address, duties, fee },
    failureEmail: failureEmailFor({
      firstName,
      actName,
      date,
      phone: row.phone,
      reminderLabel,
    }),
  });
};

const claimAndSendAvailabilityReminder = async ({ row, field, final = false }) => {
  const claimed = await AvailabilityModel.findOneAndUpdate(
    { _id: row._id, reply: null, [field]: null },
    { $set: { [field]: new Date(), availabilityReminderFailure: "" } },
    { new: true },
  ).lean();
  if (!claimed) return false;

  try {
    await sendAvailabilityReminder({ row: claimed, final });
    return true;
  } catch (error) {
    await AvailabilityModel.updateOne(
      { _id: row._id },
      {
        $set: {
          [field]: null,
          availabilityReminderFailure: String(error?.message || error),
        },
      },
    );
    throw error;
  }
};

const runAvailabilityChasers = async (now = Date.now()) => {
  if (
    String(process.env.TWILIO_AVAILABILITY_REMINDERS_ENABLED || "true")
      .trim()
      .toLowerCase() === "false"
  ) {
    console.log("⏸️ Availability reminders are disabled by configuration.");
    return;
  }

  const rows = await AvailabilityModel.find({
    reply: null,
    confirmedBooking: { $ne: true },
    requestKey: { $exists: true, $ne: "" },
    requestId: { $exists: true, $ne: "" },
    messageSidOut: { $exists: true, $ne: "" },
    deliveryStatus: { $nin: ["failed", "undelivered"] },
  }).lean();

  for (const row of rows) {
    const startedAt = new Date(row.outboundSentAt || row.createdAt || 0).getTime();
    if (!Number.isFinite(startedAt) || startedAt <= 0) continue;
    const ageHours = (now - startedAt) / 3_600_000;

    try {
      if (ageHours >= 72 && !row.finalAvailabilityReminderSentAt) {
        await claimAndSendAvailabilityReminder({
          row,
          field: "finalAvailabilityReminderSentAt",
          final: true,
        });
      } else if (ageHours >= 48 && !row.secondAvailabilityReminderSentAt) {
        await claimAndSendAvailabilityReminder({
          row,
          field: "secondAvailabilityReminderSentAt",
        });
      } else if (ageHours >= 24 && !row.firstAvailabilityReminderSentAt) {
        await claimAndSendAvailabilityReminder({
          row,
          field: "firstAvailabilityReminderSentAt",
        });
      }
    } catch (error) {
      console.error("❌ Availability reminder failed", {
        availabilityId: row._id,
        error: error?.message || error,
      });
    }
  }
};

export const runChaseAndEscalation = async () => {
  console.log("⏱️ Running chase + escalation cron", new Date().toISOString());

  const now = Date.now();
  const messages = await EnquiryMessage.find({
    "meta.kind": "booking",
    $or: [{ reply: null }, { reply: { $exists: false } }],
  }).sort({ createdAt: 1 }).lean();

  for (const msg of messages) {
    const reconciliation = await reconcilePendingRoleOffer(msg);
    if (reconciliation?.resolved) {
      console.log("✅ Skipping chase: booking role is already allocated", {
        messageId: msg._id,
        bookingRef: msg.bookingRef,
        roleSlotId: msg.roleSlotId,
        musicianId: msg.musicianId,
      });
      continue;
    }
    const ageHours = (now - new Date(msg.createdAt).getTime()) / 3_600_000;
    const firstName = await firstNameFor(msg);
    try {
      if (ageHours >= 72 && !msg.autoEscalatedAt) {
        await sendRepeatRequest({ msg, firstName });
        await EnquiryMessage.updateOne(
          { _id: msg._id, autoEscalatedAt: null },
          { $set: { autoEscalatedAt: new Date() } },
        );
        await escalateToNextDeputy(msg);
        continue;
      }

      if (ageHours >= 48 && !msg.secondChaseSentAt) {
        await sendRepeatRequest({ msg, firstName });
        await EnquiryMessage.updateOne(
          { _id: msg._id },
          { $set: { secondChaseSentAt: new Date() } },
        );
        continue;
      }

      if (ageHours >= 24 && !msg.chaseSentAt) {
        await sendRepeatRequest({ msg, firstName });
        await EnquiryMessage.updateOne(
          { _id: msg._id },
          { $set: { chaseSentAt: new Date() } },
        );
      }
    } catch (error) {
      console.error("❌ Chase/escalation failed", { messageId: msg._id, error: error?.message });
    }
  }

  await runAvailabilityChasers(now);

  console.log("⏱️ Chase + escalation cron finished.");
};
