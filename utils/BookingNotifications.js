
// utils/bookingNotifications.js
import musicianModel from "../models/musicianModel.js";
import sendEmail from "../utils/sendEmail.js";
import { sendWAOrSMS } from "../utils/twilioClient.js";


const fmtDate = (dLike) => {
  const d = new Date(dLike);
  if (Number.isNaN(d.getTime())) return String(dLike || "TBC");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/**
 * Notify all musicians in a lineup that a booking is confirmed.
 * - Attempts WhatsApp first using your Twilio content sender; falls back to SMS automatically.
 * - Sends a concise email using your nodemailer helper.
 */
// helper: phone normaliser (kept simple – mirrors your other controllers)
const normalizePhone = (raw = "") => {
  let v = String(raw || "").replace(/\s+/g, "").replace(/^whatsapp:/i, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

// helper: best-effort client first name
const clientFirstNameOf = (booking = {}) => {
  const A = String(booking?.clientName || "").trim();
  if (A) return A.split(/\s+/)[0];
  const B = String(booking?.userAddress?.firstName || "").trim();
  if (B) return B.split(/\s+/)[0];
  const C = String(booking?.userAddress?.name || "").trim();
  if (C) return C.split(/\s+/)[0];
  return "the client";
};

// helper: derive a per-member fee if member.fee isn’t set
const deriveMemberFee = (member, lineup) => {
  // 1) explicit per-member fee on the lineup member
  if (Number.isFinite(Number(member?.fee)) && Number(member.fee) > 0) {
    return Math.round(Number(member.fee));
  }

  // 2) lineup.total fee split across members (common shape base_fee[0].total_fee)
  const allMembers = Array.isArray(lineup?.band_members)
    ? lineup.band_members
    : Array.isArray(lineup?.bandMembers)
    ? lineup.bandMembers
    : [];

  const total =
    Number(lineup?.base_fee?.[0]?.total_fee ??
           lineup?.base_fee?.total_fee ??
           0) || 0;

  if (total > 0 && allMembers.length > 0) {
    return Math.ceil(total / allMembers.length);
  }

  // 3) fallback
  return 0;
};

const BookingNotifications = async (booking, act, lineup) => {
  try {
    const messagesSent = [];
    const emailsSent = [];

    const members = Array.isArray(lineup?.band_members)
      ? lineup.band_members
      : Array.isArray(lineup?.bandMembers)
      ? lineup.bandMembers
      : [];

    const eventDateText = fmtDate(booking?.date);
    const venueName = booking?.venue?.name || booking?.venueName || "TBC venue";
    const locationText =
      booking?.venue?.address || booking?.venueAddress || venueName;
    const actName = act?.tscName || act?.name || "the band";

    // NEW: client first name once here
    const clientFirstName = clientFirstNameOf(booking);

    for (const member of members) {
      // Load full musician doc (for email/phone)
      const musicianId = member?.musicianId || member?._id;
      const musician = musicianId
        ? await musicianModel.findById(musicianId).lean()
        : null;
      if (!musician) continue;

      const firstName = (musician.firstName || musician.name || "there")
        .toString()
        .split(/\s+/)[0];

      const toPhone = normalizePhone(musician.phone || musician.phoneNumber || "");
      const toEmail = musician.email || musician.emailAddress || "";

      // Duties for copy / template
      const duties = member?.instrument || "Performance";

      // Per-member fee (number) + formatted for SMS
      const feeNum = deriveMemberFee(member, lineup);
      const feeText = feeNum > 0 ? `£${feeNum}` : "TBC";

      // --- UPDATED SMS COPY (as requested) ---
      const smsBody =
        `Hi ${firstName}, ${clientFirstName} would like to book you with ${actName} on ${eventDateText} ` +
        `at ${venueName} at a rate of ${feeText} for ${duties} duties. Are you able to accept the booking? Reply YES or NO. Thanks!`;

      // For WA template senders we pass variables (kept in sync with sms)
      const templateParams = {
        FirstName: firstName,
        FormattedDate: eventDateText,
        FormattedAddress: locationText,
        Duties: duties,
        ActName: actName,
        Fee: feeText.replace(/^£/, ""), // if your WA template expects just the number, remove £
        EnquiryId: `BK_${Date.now()}`,
        ClientFirstName: clientFirstName, // in case your template wants to show it
      };

      // --- Send WA→SMS (fallback) ---
      if (toPhone) {
        try {
const res = await sendWAOrSMS({ to: toPhone, smsBody: smsBody });          messagesSent.push({ to: toPhone, channel: res?.channel || "unknown", sid: res?.sid });
        } catch (e) {
          console.warn("⚠️ WA/SMS send failed for", toPhone, e?.message || e);
        }
      }

      // --- Send Email (unchanged content for now) ---
      if (toEmail) {
        try {
          const subject = `Booking confirmed: ${actName} – ${eventDateText}`;
          const html = `
            <p>Hi ${firstName},</p>
            <p>Your booking is <strong>confirmed</strong>.</p>
            <ul>
              <li><strong>Act:</strong> ${actName}</li>
              <li><strong>Date:</strong> ${eventDateText}</li>
              <li><strong>Location:</strong> ${locationText}</li>
            </ul>
            <p>A calendar invite will follow to confirm the date in your diary.</p>
            <p>Thanks,<br/>The Supreme Collective</p>
          `;
          await sendEmail(toEmail, subject, html);
          emailsSent.push(toEmail);
        } catch (e) {
          console.warn("⚠️ Email send failed for", toEmail, e?.message || e);
        }
      }
    }

    return { success: true, messagesSent, emailsSent };
  } catch (error) {
    console.error("Notification Error:", error);
    return { success: false, messagesSent: [], emailsSent: [], error };
  }
};

export default BookingNotifications;