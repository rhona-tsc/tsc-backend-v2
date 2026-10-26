// services/messenger.ts
import Twilio from "twilio";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";

const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_WHATSAPP = process.env.TWILIO_WA_SENDER
const FROM_SMS = process.env.TWILIO_SMS_FROM

export async function sendBookingRequest({ to, useWhatsApp, vars }) {
      console.log(`🩵 (services/messenger.js) sendBookingRequest START at ${new Date().toISOString()}`, { });

  if (useWhatsApp) {
    const result = await sendWhatsAppMessage({
      to,
      contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
      allowDefaultContentSid: false,
      variables: {
        "1": vars.name,
        "2": vars.date,
        "3": vars.location,
        "4": String(vars.fee || ""),
        "5": vars.duties || vars.role,
        "6": vars.actName,
      },
      allowSmsFallback: false,
      source: "legacy-booking-request",
      requireOpportunityDetails: true,
      opportunityDetails: {
        actName: vars.actName,
        date: vars.date,
        address: vars.location,
        duties: vars.duties || vars.role,
        fee: vars.fee,
      },
    });
    return { channel: "whatsapp", ok: true, sid: result?.sid || "" };
  }
  // Explicit SMS sends remain available when SMS was deliberately selected;
  // this is not used as an automatic WhatsApp fallback.
  await client.messages.create({
    from: FROM_SMS,
    to,
    body: `Hi ${vars.name}, booking request: ${vars.date}, ${vars.location}, role: ${vars.role} (${vars.duties}), fee £${vars.fee}. Reply YES or NO.`
  });
  return { channel: "sms", ok: true };
}

export async function sendConfirmed({ to, channel }) {
        console.log(`🩵 (services/messenger.js) sendConfirmed START at ${new Date().toISOString()}`, { });

  const from = channel === "whatsapp" ? FROM_WHATSAPP : FROM_SMS;
  const prefix = channel === "whatsapp" ? "whatsapp:" : "";
  await client.messages.create({
    from,
    to: `${prefix}${to}`,
    body: `Brilliant — thanks for confirming! We'll send a diary invite shortly.`
  });
}

export async function sendDeclined({ to, channel }) {
        console.log(`🩵 (services/messenger.js) sendDeclined START at ${new Date().toISOString()}`, { });

  const from = channel === "whatsapp" ? FROM_WHATSAPP : FROM_SMS;
  const prefix = channel === "whatsapp" ? "whatsapp:" : "";
  await client.messages.create({
    from,
    to: `${prefix}${to}`,
    body: `Thanks for letting us know your availability — we’ve updated our system.`
  });
}
