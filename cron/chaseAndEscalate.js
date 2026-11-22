import {activeAllocationHold} from '../utils/bookingAllocationPolicy.js';
// cron/chaseAndEscalate.js
import EnquiryMessage from "../models/EnquiryMessage.js";
import Musician from "../models/musicianModel.js";
import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import Act from "../models/actModel.js";
import mongoose from "mongoose";
import { sendWhatsAppMessage, fetchWhatsAppMessageStatus, toE164 } from "../utils/twilioClient.js";
import { createAvailabilityReminderRunner } from "../services/availabilityReminderService.js";
import { findPriorAvailabilityDecline } from '../services/availabilityPriorDeclines.js';
import {
  escalateToNextDeputy,
  reconcilePendingRoleOffer,
  sanitizeFee,
} from "../controllers/allocationController.js";
import {
  validAvailabilityRecipientName,
} from "../utils/enquiryAutomationEligibility.js";

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

  if (!validAvailabilityRecipientName(firstName)) {
    throw new Error("Availability reminder blocked: recipient name is missing or invalid");
  }

  return sendWhatsAppMessage({
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

export const availabilityReminderScopeState = async (row) => {
  if (!row?.enquiryId || !row.actId || !row.lineupId || !row.dateISO) {
    return { active: false, reason: "missing-exact-scope" };
  }
  if (await findPriorAvailabilityDecline({
    dateISO: row.dateISO, musicianId: row.musicianId,
    phone: row.phone, formattedAddress: row.formattedAddress,
  })) return { active: false, reason: "musician-declined-date-or-location" };
  const references = [{ enquiryRef: row.enquiryId }];
  if (mongoose.isValidObjectId(row.enquiryId)) {
    references.push({ _id: row.enquiryId }, { enquiryId: row.enquiryId });
  }
  const scope = {
    enquiryId: row.enquiryId, actId: row.actId,
    lineupId: row.lineupId, dateISO: row.dateISO,
  };
  const enquiry = await EnquiryBoardItem.findOne({
    $or: references, actId: row.actId, lineupId: String(row.lineupId),
    eventDateISO: row.dateISO,
  }).select("status").lean();
  // Contacted enquiries already have a client/agency response in this workflow.
  // Closed, converted and uncorrelated enquiries must not restart musician outreach.
  if (!enquiry || !["open", "qualified"].includes(enquiry.status)) {
    return { active: false, reason: "enquiry-not-awaiting-availability" };
  }
  if (await BookingBoardItem.exists({
    bookingRef: row.enquiryId, actId: row.actId, eventDateISO: row.dateISO,
  })) return { active: false, reason: "converted-to-booking" };
  if (await AvailabilityModel.exists({ ...scope, reply: "yes" })) {
    return { active: false, reason: "lead-already-confirmed-for-enquiry" };
  }
  const act = await Act.findById(row.actId).select("lineups").lean();
  const lineup = act?.lineups?.find(item =>
    [String(item._id), String(item.lineupId)].includes(String(row.lineupId)));
  if (!lineup) return { active: false, reason: "lineup-not-found" };
  const member = lineup.bandMembers?.find(item =>
    (item.musicianId && String(item.musicianId) === String(row.musicianId)) ||
    (toE164(item.phoneNumber || item.phone) && toE164(item.phoneNumber || item.phone) === toE164(row.phone)));
  if (member?.skipAvailabilityChecks === true) {
    return { active: false, reason: "musician-outreach-disabled" };
  }
  return { active: true };
};

export const runAvailabilityChasers = createAvailabilityReminderRunner({
  Availability: AvailabilityModel,
  getScopeState: availabilityReminderScopeState,
  getOriginalDelivery: async row => {
    const original = await fetchWhatsAppMessageStatus(row.messageSidOut);
    return toE164(original.to) === toE164(row.phone)
      ? original : { status: "recipient-mismatch" };
  },
  sendReminder: sendAvailabilityReminder,
  enabled: () => String(process.env.TWILIO_AVAILABILITY_REMINDERS_ENABLED || "true")
    .trim().toLowerCase() !== "false",
});

export const runChaseAndEscalation = async () => {
  console.log("⏱️ Running chase + escalation cron", new Date().toISOString());

  const now = Date.now();
  const messages = await EnquiryMessage.find({
    "meta.kind": "booking",
    $or: [{ reply: null }, { reply: { $exists: false } }],
  }).sort({ createdAt: 1 }).lean();

  for (const msg of messages) {
    const holdBoard=msg.bookingBoardItemId?await BookingBoardItem.findById(msg.bookingBoardItemId).lean():null;
    if(holdBoard && activeAllocationHold(holdBoard,msg.roleSlotId)) continue;
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

  console.log("⏱️ Chase + escalation cron finished.");
};
