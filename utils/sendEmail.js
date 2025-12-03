import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/**
 * Send an email using the configured transporter
 * @param {string|string[]} to - Recipient email(s)
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @param {Array} attachments - Optional array of attachments
 */
// utils/sendEmail.js
async function sendEmail({ to, cc, bcc, subject, html, text, from }) {
  const toArr = [to].flat().filter(Boolean);
  const ccArr = [cc].flat().filter(Boolean);
  const bccArr = [bcc].flat().filter(Boolean);

  const isEmail = (s) => typeof s === "string" && /\S+@\S+\.\S+/.test(s.trim());

  const recipients = [...new Set([...toArr, ...ccArr].filter(isEmail))];
  const bccRecipients = [...new Set(bccArr.filter(isEmail))];

  if (!recipients.length && !bccRecipients.length) {
    console.warn("⚠️ No valid email recipients found. Skipping sendEmail.", {
      to, cc, bcc, subject
    });
    return { ok: false, skipped: true, reason: "no_recipients" };
  }

  // DRY-RUN guard
  if (process.env.SEND_EMAILS !== "true") {
    console.log("✉️ [DRY-RUN] sendEmail", { recipients, bccRecipients, subject });
    return { ok: true, dryRun: true, recipients, bccRecipients };
  }

  const mail = {
    from: from || process.env.DEFAULT_FROM || "hello@thesupremecollective.co.uk",
    to: recipients,
    bcc: bccRecipients.length ? bccRecipients : undefined,
    subject,
    text,
    html,
  };

  const info = await transporter.sendMail(mail);
  console.log("📤 [sendEmail] nodemailer result", {
    messageId: info?.messageId,
    accepted: info?.accepted,
    rejected: info?.rejected,
    response: info?.response
  });

  return {
    ok: Array.isArray(info?.accepted) && info.accepted.length > 0,
    messageId: info?.messageId,
    accepted: info?.accepted || [],
    rejected: info?.rejected || [],
    response: info?.response || null
  };
}

export default sendEmail;
export { sendEmail };