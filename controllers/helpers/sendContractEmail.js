// controllers/helpers/sendContractEmail.js
import path from "path";
import ejs from "ejs";
import { fileURLToPath } from "url";
import cloudinary from "cloudinary";
import { launchBrowser } from "../bookingController.js";
import { resolveSignatureGifPath } from "../../utils/signaturePath.js";
import transporter from "../../config/emailTransporter.js";
import BookingBoardItem from "../../models/bookingBoardModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function sendContractEmail({ booking }) {
  if (!booking) throw new Error("Missing booking");
  if (!booking?.userAddress?.email) throw new Error("Missing client email");

  const templatePath = path.join(__dirname, "..", "views", "contractTemplate.ejs");

  // 1️⃣ Render HTML
  const html = await ejs.renderFile(templatePath, {
    bookingId: booking.bookingId,
    userAddress: booking.userAddress,
    actsSummary: booking.actsSummary,
    total: booking.totals?.fullAmount ?? booking.amount,
    deposit: booking.totals?.depositAmount ?? booking.amount,
    signatureUrl: booking.signatureUrl,
    logoUrl: `https://res.cloudinary.com/dvcgr3fyd/image/upload/v1746015511/TSC_logo_u6xl6u.png`,
  });

  // 2️⃣ Generate PDF
  const browser = await launchBrowser({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const pdfBuffer = await page.pdf({ format: "A4" });
  await browser.close();

  // 3️⃣ Upload PDF to Cloudinary
  const pdfUrl = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", public_id: `contracts/${booking.bookingId}` },
      (err, result) => {
        if (err) return reject(err);
        resolve(result?.secure_url || null);
      }
    );
    stream.end(pdfBuffer);
  });

  if (pdfUrl) {
    booking.pdfUrl = pdfUrl;
    await booking.save();

    await BookingBoardItem.updateOne(
      { bookingRef: booking.bookingId },
      { $set: { contractUrl: pdfUrl, pdfUrl } },
      { upsert: true }
    );
  }

  // 4️⃣ Build and send email
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

  const fourWeeksBefore = new Date(eventDate);
  fourWeeksBefore.setDate(fourWeeksBefore.getDate() - 28);

  const twoWeeksBefore = new Date(eventDate);
  twoWeeksBefore.setDate(twoWeeksBefore.getDate() - 14);

  const eventSheetUrl = `${
    process.env.FRONTEND_BASE_URL || "http://localhost:5174"
  }/event-sheet/${booking.bookingId}`;

  const bodyHtml = `
    <p>Hi ${booking?.userAddress?.firstName || ""},</p>
    <p>Thank you for booking <strong>${tscName}</strong>! They’re very much looking forward to performing for you.</p>
    <p>Please fill in your <a href="${eventSheetUrl}"><strong>Event Sheet</strong></a>.</p>
    <p><strong>Key dates:</strong></p>
    <ul>
      <li>Song suggestions due: <strong>${fmt(fourWeeksBefore)}</strong></li>
      <li>Event sheet + balance due: <strong>${fmt(twoWeeksBefore)}</strong></li>
    </ul>
    <p>Warmest wishes,<br/><strong>The Supreme Collective</strong> 💫</p>
  `;

  const sigPath = resolveSignatureGifPath();
  const signatureAttachment = sigPath
    ? [{
        filename: "signature.gif",
        path: sigPath,
        cid: "signature.gif",
        contentDisposition: "inline",
      }]
    : [];

  await transporter.sendMail({
    from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
    to: booking.userAddress.email,
    bcc: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
    subject: `Booking Confirmation – ${booking.bookingId}`,
    html: bodyHtml,
    attachments: [
      { filename: `Booking_${booking.bookingId}.pdf`, content: pdfBuffer },
      ...signatureAttachment,
    ],
  });

  return pdfUrl;
}