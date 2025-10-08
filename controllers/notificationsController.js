// controllers/notificationsController.js
import Booking from "../models/bookingModel.js";
import Act from "../models/actModel.js";
import nodemailer from "nodemailer";
import axios from "axios";
import sendEmail from "../utils/sendEmail.js";

const buildTransport = () => {
  // If you haven’t set SMTP, we’ll no-op but still 200 for dev.
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
};

const findMemberEmails = async (booking) => {
  // 1) Prefer populated bandLineup musician docs (if you store them)
  const emailsFromBandLineup = Array.isArray(booking?.bandLineup)
    ? booking.bandLineup
        .map((m) => (typeof m === "object" ? (m.email || m.contactEmail) : null))
        .filter(Boolean)
    : [];

  if (emailsFromBandLineup.length) return emailsFromBandLineup;

  // 2) Try to resolve lineup on the Act by lineupId and pull emails
  try {
    const actId = booking?.act;
    const lineupId = booking?.lineupId ||
      (Array.isArray(booking?.actsSummary) && booking.actsSummary[0]?.lineupId);
    if (!actId || !lineupId) return [];

    const act = await Act.findById(actId).lean();
    const lineup = (act?.lineups || []).find(
      (l) => String(l._id) === String(lineupId) || String(l.lineupId) === String(lineupId)
    );
    const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
    return members.map((m) => m.email || m.contactEmail).filter(Boolean);
  } catch {
    return [];
  }
};

// Send menu to band (cc caterer)
export const sendMenuToBand = async (req, res) => {
  try {
    const { bookingId, catererEmail, menu = {}, dietarySummary = [] } = req.body || {};
    if (!bookingId) return res.status(400).json({ success: false, message: "bookingId is required" });

    const booking = await Booking.findOne({ $or: [{ bookingId }, { _id: bookingId }] }).lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    // Resolve band emails
    const bandEmails = await findMemberEmails(booking);
    const recipients = [...new Set([
      "hello@thesupremecollective.co.uk",
      ...bandEmails,
    ])].filter(Boolean);

    const cc = (catererEmail || "").trim();

    // Attach uploaded file if we have a URL
    const attachments = [];
    if (menu.fileUrl && /^https?:\/\//i.test(menu.fileUrl)) {
      try {
        const resp = await axios.get(menu.fileUrl, { responseType: "arraybuffer" });
        const contentType = resp.headers["content-type"] || "application/octet-stream";
        attachments.push({
          filename: "menu",
          content: Buffer.from(resp.data),
          contentType,
        });
      } catch (e) {
        console.warn("Menu fetch failed; will include link only:", e?.message);
      }
    }

    // Build a mini dietary table
    const dietaryHtml = Array.isArray(dietarySummary) && dietarySummary.length
      ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
           <thead>
             <tr><th align="left">Name</th><th align="left">Instrument</th><th align="left">Diet</th></tr>
           </thead>
           <tbody>
             ${dietarySummary.map(r => `
               <tr>
                 <td>${r.name || ""}</td>
                 <td>${r.instrument || ""}</td>
                 <td>${r.diet || "None stated"}</td>
               </tr>
             `).join("")}
           </tbody>
         </table>`
      : "<p>No dietary details yet.</p>";

    const html = `
      <p>Hi ${booking?.act ? "band" : "team"},</p>
      <p>Menu for booking <strong>${booking.bookingId || booking._id}</strong>.</p>
      ${menu.url ? `<p>Menu link: <a href="${menu.url}" target="_blank" rel="noreferrer">${menu.url}</a></p>` : ""}
      ${menu.text ? `<pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:8px;border-radius:4px">${menu.text}</pre>` : ""}
      ${menu.notes ? `<p><strong>Notes:</strong> ${menu.notes}</p>` : ""}
      <h4>Dietary requirements</h4>
      ${dietaryHtml}
      <p>Thanks,<br/>TSC Event Sheet Bot</p>
    `;

    const subject = `Menu – ${booking.bookingId || "booking"}`;

    const to = recipients.join(",");
    const r = await sendEmail(to, subject, html, attachments, cc ? [cc] : undefined);
    if (!r?.success) {
      return res.status(500).json({ success: false, message: "Email send failed", error: r?.error?.message });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("sendMenuToBand error:", err);
    return res.status(500).json({ success: false, message: "Failed to send menu to band" });
  }
};

// Send dietary requirements to caterer
export const sendDietaryToCaterer = async (req, res) => {
  try {
    const { bookingId, catererEmail, dietarySummary = [], serviceNotes = "", notes = "", menu = {} } = req.body || {};
    const to = (catererEmail || "").trim();
    if (!bookingId || !to) {
      return res.status(400).json({ success: false, message: "bookingId and catererEmail are required" });
    }

    const booking = await Booking.findOne({ $or: [{ bookingId }, { _id: bookingId }] }).lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    // Optional attachment if a fileUrl exists
    const attachments = [];
    if (menu.fileUrl && /^https?:\/\//i.test(menu.fileUrl)) {
      try {
        const resp = await axios.get(menu.fileUrl, { responseType: "arraybuffer" });
        const contentType = resp.headers["content-type"] || "application/octet-stream";
        attachments.push({
          filename: "menu",
          content: Buffer.from(resp.data),
          contentType,
        });
      } catch (e) {
        console.warn("Menu fetch failed for caterer; including link only:", e?.message);
      }
    }

    const dietaryHtml = Array.isArray(dietarySummary) && dietarySummary.length
      ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
           <thead>
             <tr><th align="left">Name</th><th align="left">Instrument</th><th align="left">Diet</th></tr>
           </thead>
           <tbody>
             ${dietarySummary.map(r => `
               <tr>
                 <td>${r.name || ""}</td>
                 <td>${r.instrument || ""}</td>
                 <td>${r.diet || "None stated"}</td>
               </tr>
             `).join("")}
           </tbody>
         </table>`
      : "<p>No dietary details yet.</p>";

    const html = `
      <p>Hello,</p>
      <p>Dietary requirements and service notes for booking <strong>${booking.bookingId || booking._id}</strong>.</p>
      ${dietaryHtml}
      ${serviceNotes ? `<p><strong>Service notes:</strong> ${serviceNotes}</p>` : ""}
      ${notes ? `<p><strong>Additional notes from client:</strong> ${notes}</p>` : ""}
      ${menu.url ? `<p>Menu link (if needed): <a href="${menu.url}" target="_blank" rel="noreferrer">${menu.url}</a></p>` : ""}
      <p>Thanks,<br/>The Supreme Collective</p>
    `;

    const subject = `Dietary requirements – ${booking.bookingId || "booking"}`;

    // to caterer, cc the office
    const recipients = to;
    const r = await sendEmail([recipients, "hello@thesupremecollective.co.uk"].join(","), subject, html, attachments);
    if (!r?.success) {
      return res.status(500).json({ success: false, message: "Email send failed", error: r?.error?.message });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("sendDietaryToCaterer error:", err);
    return res.status(500).json({ success: false, message: "Failed to send dietary to caterer" });
  }
};

export const docSigningRequest = async (req, res) => {
  try {
    const { bookingId, _id, to, subject, docName, docUrl, venueEmail } = req.body || {};

    const targetTo = (to && Array.isArray(to) ? to : [to]).filter(Boolean);
    const ccVenue = (venueEmail || "").trim();
    const recipients = [...new Set([
      "hello@thesupremecollective.co.uk",
      ...targetTo,
      ...(ccVenue ? [ccVenue] : []),
    ])];

    const ref = bookingId || _id || "Unknown booking";
    const emailSubject = subject || `Doc signing requested – ${ref}`;

    const attachments = [];
    let bodyNote = "";

    if (docUrl && /^https?:\/\//i.test(docUrl)) {
      try {
        const resp = await axios.get(docUrl, { responseType: "arraybuffer" });
        const contentType = resp.headers["content-type"] || "application/pdf";
        attachments.push({
          filename: docName || "document.pdf",
          content: Buffer.from(resp.data),
          contentType,
        });
        bodyNote = `<p>Document attached: <strong>${docName || "file"}</strong></p>`;
      } catch (e) {
        console.warn("Could not fetch document to attach; including link:", e?.message);
        bodyNote = `<p>Document link: <a href="${docUrl}" target="_blank" rel="noreferrer">${docName || docUrl}</a></p>`;
      }
    } else if (docUrl) {
      bodyNote = `<p>Document: <code>${docUrl}</code></p>`;
    }

    const html = `
      <p>Hi team,</p>
      <p>This is the TSC Event Sheet Bot here 👋. The client has requested band signatures on this document for their venue (that may be in cc).</p>
      <ul>
        <li><strong>Booking ref:</strong> ${ref}</li>
      </ul>
      <p>The TSC Team will follow up to confirm when signed.</p>
      ${bodyNote}
      <p>Thanks,<br/>TSC Event Sheet Bot</p>
    `;

    const result = await sendEmail(recipients.join(","), emailSubject, html, attachments);
    if (!result?.success) {
      return res.status(500).json({ success: false, message: "Email send failed", error: result?.error?.message });
    }
    return res.status(200).json({ success: true, queued: false });
  } catch (err) {
    console.error("docSigningRequest error:", err);
    return res.status(500).json({ success: false, message: "Failed to send doc-signing email." });
  }
};