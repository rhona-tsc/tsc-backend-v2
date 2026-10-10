// cron/chaseAndEscalate.js
import EnquiryMessage from "../models/EnquiryMessage.js";
import Musician from "../models/musicianModel.js";
import { sendWhatsAppMessage, sendWhatsAppText, sendSMSMessage } from "../utils/twilioClient.js";
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

const sendTextWithFallback = async (phone, body) => {
  try {
    await sendWhatsAppText(phone, body);
  } catch {
    await sendSMSMessage(phone, body);
  }
};

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
  });
};

export const runChaseAndEscalation = async () => {
  console.log("⏱️ Running chase + escalation cron", new Date().toISOString());

  const now = Date.now();
  const messages = await EnquiryMessage.find({
    "meta.kind": "booking",
    $or: [{ reply: null }, { reply: { $exists: false } }],
  }).sort({ createdAt: 1 }).lean();

  for (const msg of messages) {
    await reconcilePendingRoleOffer(msg);
    const ageHours = (now - new Date(msg.createdAt).getTime()) / 3_600_000;
    const firstName = await firstNameFor(msg);
    try {
      if (ageHours >= 72 && !msg.autoEscalatedAt) {
        await sendTextWithFallback(
          msg.phone,
          `Hi ${firstName}, as we haven't heard back, we've now passed this role to another musician. ` +
            `You're still welcome to accept in the meantime, but we can't guarantee it will still be available. 🤍 TSC`,
        );
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
