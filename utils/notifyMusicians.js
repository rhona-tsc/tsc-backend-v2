import twilio from "twilio";
import nodemailer from "nodemailer";
import musicianModel from "../models/musicianModel.js";

// ✅ Match your .env keys
const accountSid   = process.env.TWILIO_ACCOUNT_SID;
const authToken    = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WA_SENDER; // e.g. +15557365618

const client = twilio(accountSid, authToken);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

async function notifyMusicians(musicianIds, bookingDetails) {
  const musicians = await musicianModel.find({ _id: { $in: musicianIds } });

  for (const musician of musicians) {
    const { firstName, phone, email } = musician;
    const { clientName, actName, date, venueName, fee, travelFee } = bookingDetails;

    const message =
      `🎶 Hi ${firstName},\n\n` +
      `You've been booked for a performance with ${actName} on ${date} at ${venueName}.\n` +
      `Client: ${clientName}\nFee: £${fee}\nTravel: £${travelFee}\n\nSee your dashboard for more.`;

    if (phone && whatsappFrom) {
      try {
        const to = phone.startsWith("+") ? phone : phone.replace(/^0/, "+44");
        await client.messages.create({
          body: message,
          from: `whatsapp:${whatsappFrom}`,
          to: `whatsapp:${to}`,
        });
        console.log(`✅ WhatsApp sent to ${firstName}`);
      } catch (err) {
        console.error(`❌ WhatsApp error for ${firstName}:`, err.message);
      }
    }

    if (email) {
      try {
        await transporter.sendMail({
          from: `"The Supreme Collective" <${process.env.GMAIL_USER}>`,
          to: email,
          subject: `🎤 Booking Confirmed: ${actName} on ${date}`,
          text: message,
        });
        console.log(`📧 Email sent to ${firstName}`);
      } catch (err) {
        console.error(`❌ Email error for ${firstName}:`, err.message);
      }
    }
  }
}

export default notifyMusicians;