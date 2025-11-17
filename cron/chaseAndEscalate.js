// cron/chaseAndEscalate.js
import EnquiryMessage from "../models/EnquiryMessage.js";
import { sendWhatsAppMessage, sendSMSMessage } from "../utils/twilioClient.js";
import { escalateToNextDeputy_v2 as escalateToNextDeputy } from "../controllers/allocationController.js";
import { sanitizeFee } from "../controllers/allocationController.js";

export const runChaseAndEscalation = async () => {
  console.log("⏱️ Running chase + escalation cron", new Date().toISOString());

  const now = Date.now();

  // Pull booking enquiries awaiting reply
  const messages = await EnquiryMessage.find({
    "meta.kind": "booking",
    $or: [{ reply: null }, { reply: { $exists: false } }],
  }).lean();

  if (!messages.length) {
    console.log("⏱️ No pending enquiries to chase/escalate");
    return;
  }

  for (const msg of messages) {
    const ageHours =
      (now - new Date(msg.createdAt).getTime()) / (60 * 60 * 1000);

    const phone = msg.phone;
    const waTo = phone.startsWith("whatsapp:") 
      ? phone 
      : `whatsapp:${phone}`;

    const formattedDate = msg.formattedDate || msg.meta?.MetaISODate;
    const formattedAddress = msg.formattedAddress || msg.meta?.MetaAddress;
    const actName = msg.meta?.actName || "the band";
    const feeClean = sanitizeFee(msg.fee);
    const duties = msg.duties || "performance";
    const firstName = msg.musicianName || "there";

    /* --------------------------------------------------------
     * 1️⃣ SEND CHASE AT 24 HOURS
     * --------------------------------------------------------*/
    if (ageHours >= 24 && !msg.chaseSentAt) {
      console.log("📣 Sending 24-hour chase →", phone);

      const smsBody =
        `Hi ${firstName}, just checking you saw the booking request for ` +
        `${formattedDate} at ${formattedAddress} with ${actName}. ` +
        `If you're available, reply YES. If you're already booked, reply NO. ` +
        `If it's too far, reply NOLOC. 🤍 TSC`;

      try {
        // You can optionally configure a WA template
        const chaseSid = process.env.TWILIO_DEPUTY_CHASE_SID;

        if (chaseSid) {
          await sendWhatsAppMessage({
            to: waTo,
            contentSid: chaseSid,
            variables: {
              1: firstName,
              2: formattedDate,
              3: formattedAddress,
              4: feeClean,
              5: duties,
              6: actName,
            },
            smsBody,
          });
          console.log("📣 Chase WA sent");
        } else {
          // SMS-only version (works without a template)
          await sendSMSMessage(phone, smsBody);
          console.log("📣 Chase SMS sent");
        }

        await EnquiryMessage.updateOne(
          { _id: msg._id },
          { $set: { chaseSentAt: new Date() } }
        );
      } catch (err) {
        console.error("❌ Chase send failed:", err);
      }

      continue; // prevent escalation same cycle
    }

    /* --------------------------------------------------------
     * 2️⃣ AUTO-ESCALATE AT 72 HOURS
     * --------------------------------------------------------*/
    if (ageHours >= 72 && !msg.autoEscalatedAt) {
      console.log("⚠️ Auto-escalating after 72h →", phone);

      // A. Courtesy message to the original musician
      const smsBody =
        `No worries if you were busy — we've now passed the request for ` +
        `${formattedDate} to the next musician. Thanks anyway! 🤍 TSC`;

      try {
        await sendSMSMessage(phone, smsBody);
      } catch (err) {
        console.warn("⚠️ Failed to send courtesy SMS", err);
      }

      // B. Mark message as autoEscalated + "no_response"
      await EnquiryMessage.updateOne(
        { _id: msg._id },
        {
          $set: {
            autoEscalatedAt: new Date(),
            reply: "no_response",
          },
        }
      );

      // C. Escalate to next deputy (v2 logic)
      try {
        await escalateToNextDeputy(msg);
      } catch (err) {
        console.error("❌ Error auto-escalating to next deputy:", err);
      }

      continue;
    }
  }

  console.log("⏱️ Chase + escalation cron finished.");
};