import twilio from "twilio";
import Act from "../models/actModel.js";

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export const sendAvailabilityMessage = async ({ actId, selectedDate, selectedAddress, lineupId }) => {
  try {
    const act = await Act.findById(actId).lean();
    if (!act) throw new Error("Act not found");

    console.log(`🩵 (utils/twilioHelpers.js) sendAvailabilityMessage START at ${new Date().toISOString()}`, {});

    const vocalist = act.lineups
      ?.flatMap((l) => l.bandMembers)
      ?.find((m) =>
      ["Lead Male Vocal", "Lead Female Vocal", "Lead Vocal", "Vocalist-Guitarist"].includes(
        m.instrument
      )
      );

    if (!vocalist?.phone) throw new Error("No lead vocalist phone");

    const msg = `Hi ${vocalist.firstName || ""}, can you confirm availability for ${act.tscName} on ${new Date(selectedDate).toLocaleDateString()} in ${selectedAddress}? Reply YES or NO.`;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WA_SENDER}`,
      to: `whatsapp:${vocalist.phone}`,
      body: msg,
      statusCallback: `${process.env.BACKEND_URL}/api/shortlist/twilio/status`,
    });

    console.log(`✅ WhatsApp message sent to ${vocalist.phone}`);
  } catch (err) {
    console.error("❌ sendAvailabilityMessage failed:", err.message);
  }
};