// services/messenger.ts
import Twilio from "twilio";

const client = Twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const FROM_WHATSAPP = process.env.TWILIO_WA_SENDER
const FROM_SMS = process.env.TWILIO_SMS_FROM

export async function sendBookingRequest({ to, useWhatsApp, vars }) {
  if (useWhatsApp) {
    try {
      // Template message (Interactive not shown here; you can also send with buttons)
      await client.messages.create({
        from: FROM_WHATSAPP,
        to: `whatsapp:${to}`,
        body: `Hi ${vars.name}, you’ve received a booking request for ${vars.date} in ${vars.location} for ${vars.role} (${vars.duties}) at £${vars.fee}. 
Reply YES to confirm, or NO to decline.`
      });
      return { channel: "whatsapp", ok: true };
    } catch (e) {
      // fall through to SMS
    }
  }
  // SMS fallback
  await client.messages.create({
    from: FROM_SMS,
    to,
    body: `Hi ${vars.name}, booking request: ${vars.date}, ${vars.location}, role: ${vars.role} (${vars.duties}), fee £${vars.fee}. Reply YES or NO.`
  });
  return { channel: "sms", ok: true };
}

export async function sendConfirmed({ to, channel }) {
  const from = channel === "whatsapp" ? FROM_WHATSAPP : FROM_SMS;
  const prefix = channel === "whatsapp" ? "whatsapp:" : "";
  await client.messages.create({
    from,
    to: `${prefix}${to}`,
    body: `Brilliant — thanks for confirming! We'll send a diary invite shortly.`
  });
}

export async function sendDeclined({ to, channel }) {
  const from = channel === "whatsapp" ? FROM_WHATSAPP : FROM_SMS;
  const prefix = channel === "whatsapp" ? "whatsapp:" : "";
  await client.messages.create({
    from,
    to: `${prefix}${to}`,
    body: `Thanks for letting us know your availability — we’ve updated our system.`
  });
}