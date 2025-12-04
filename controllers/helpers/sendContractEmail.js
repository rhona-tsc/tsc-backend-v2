// controllers/helpers/sendContractEmail.js
import { v2 as cloudinary } from "cloudinary";
import nodemailer from "nodemailer";
import BookingBoardItem from "../../models/bookingBoardItem.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Cloudinary here so we don't rely on bookingController.js
cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_API_SECRET,
});

// Local copy so we avoid circular import
function resolveSignatureGifPath() {
  // 1) explicit override
  if (process.env.SIGNATURE_GIF_PATH && fs.existsSync(process.env.SIGNATURE_GIF_PATH)) {
    return process.env.SIGNATURE_GIF_PATH;
  }
  // 2) dev convenience: look in ../../frontend/assets relative to this helper
  const guess = path.resolve(__dirname, "..", "..", "frontend", "assets", "TSC_Signature.gif");
  if (fs.existsSync(guess)) return guess;
  // 3) no signature image available
  return "";
}

// Local transporter (no circular import)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_PORT || "") === "465", // only true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendContractEmail({ booking, pdfBuffer }) {
  if (!booking) throw new Error("Missing booking");
  const toEmail = booking?.userAddress?.email || booking?.userEmail;
  if (!toEmail) throw new Error("Missing client email");
  if (!pdfBuffer) throw new Error("Missing pdfBuffer");

  // Upload the PDF to Cloudinary (raw file)
  const pdfUrl = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", public_id: `contracts/${booking.bookingId}` },
      (err, result) => (err ? reject(err) : resolve(result?.secure_url || null))
    );
    stream.end(pdfBuffer);
  });

  // Best-effort: persist url to board (and booking if it's a real doc)
  if (pdfUrl) {
    try {
      if (typeof booking.save === "function") {
        booking.pdfUrl = pdfUrl;
        await booking.save();
      }
    } catch (e) {
      // ignore
    }
    try {
      await BookingBoardItem.updateOne(
        { bookingRef: booking.bookingId },
        { $set: { contractUrl: pdfUrl, pdfUrl } },
        { upsert: true }
      );
    } catch (e) {
      // ignore
    }
  }

  // Build the email body (same content as your other path)
  const tscName =
    booking?.actsSummary?.[0]?.tscName ||
    booking?.actsSummary?.[0]?.actName ||
    "the band";

  const eventDate = new Date(booking.date);
  const fmt = (d) =>
    d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const fourWeeksBefore = new Date(eventDate.getTime());
  fourWeeksBefore.setDate(fourWeeksBefore.getDate() - 28);
  const twoWeeksBefore = new Date(eventDate.getTime());
  twoWeeksBefore.setDate(twoWeeksBefore.getDate() - 14);

  const eventSheetUrl = `${
    process.env.FRONTEND_BASE_URL || "http://localhost:5174"
  }/event-sheet/${booking.bookingId}`;

  const bodyHtml = `
    <p>Hi ${booking?.userAddress?.firstName || ""},</p>

    <p>Thank you for booking <strong>${tscName}</strong>! They’re very much looking forward to performing for you and your guests.</p>

    <p>When you’re ready, please click through to your <a href="${eventSheetUrl}"><strong>Event Sheet</strong></a> and kindly fill in the blanks — it will auto-save.</p>

    <p><strong>Key dates for your diary</strong>:</p>
    <ul>
      <li>Song suggestions / first dance due by <strong>${fmt(fourWeeksBefore)}</strong></li>
      <li>Completed Event Sheet and balance due by <strong>${fmt(twoWeeksBefore)}</strong></li>
    </ul>

    <p>Warmest wishes,<br/><strong>The Supreme Collective</strong> 💫</p>
  `;

  const sigPath = resolveSignatureGifPath();
  const attachments = [{ filename: `Booking_${booking.bookingId}.pdf`, content: pdfBuffer }];
  if (sigPath) {
    attachments.push({
      filename: "signature.gif",
      path: sigPath,
      cid: "signature.gif",
      contentDisposition: "inline",
    });
  }

  await transporter.sendMail({
    from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
    to: toEmail,
    bcc: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
    subject: `Booking Confirmation – ${booking.bookingId}`,
    html: bodyHtml,
    attachments,
  });

  return pdfUrl;
}