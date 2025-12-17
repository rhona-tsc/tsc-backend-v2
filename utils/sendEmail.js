import nodemailer from "nodemailer";

// Build lazily so env normalization happens before auth is used.
// Prevents pasted app-password issues like "xxxx xxxx xxxx xxxx" or trailing newlines.
let _cachedTransporter = null;
let _cachedKey = "";

const normUser = (v) => String(v || "").trim().toLowerCase();
const normPass = (v) => String(v || "").replace(/\s+/g, ""); // remove ALL whitespace

function getTransporter() {
  const user = normUser(process.env.GMAIL_USER || process.env.EMAIL_USER);
  const pass = normPass(
    process.env.GMAIL_PASS ||
      process.env.EMAIL_PASS ||
      process.env.GMAIL_APP_PASSWORD
  );

  const key = `${user}|${pass}`;

  if (!_cachedTransporter || _cachedKey !== key) {
    _cachedKey = key;

    // Never log secrets — only safe metadata
    console.log("📮 [sendEmail] SMTP snapshot", {
      user: user || undefined,
      passLen: pass ? pass.length : 0,
    });

    _cachedTransporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }

  return _cachedTransporter;
}

// utils/sendEmail.js
async function sendEmail({ to, cc, bcc, subject, html, text, from, replyTo, attachments }) {
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

  const mail = {
    from: (from || process.env.DEFAULT_FROM || "hello@thesupremecollective.co.uk").trim(),
    replyTo: replyTo ? String(replyTo).trim() : undefined,
    to: recipients,
    cc: ccArr.length ? [...new Set(ccArr.filter(isEmail))] : undefined,
    bcc: bccRecipients.length ? bccRecipients : undefined,
    subject,
    text,
    html,
    attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
  };

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail(mail);

    console.log("📤 [sendEmail] nodemailer result", {
      messageId: info?.messageId,
      accepted: info?.accepted,
      rejected: info?.rejected,
      response: info?.response,
    });

    return {
      ok: Array.isArray(info?.accepted) && info.accepted.length > 0,
      messageId: info?.messageId,
      accepted: info?.accepted || [],
      rejected: info?.rejected || [],
      response: info?.response || null,
    };
  } catch (err) {
    console.error("❌ [sendEmail] nodemailer error", {
      message: err?.message || String(err),
      code: err?.code,
      responseCode: err?.responseCode,
      command: err?.command,
      response: err?.response,
    });

    return {
      ok: false,
      error: err?.message || String(err),
      code: err?.code,
      responseCode: err?.responseCode,
      response: err?.response || null,
    };
  }
}

export default sendEmail;
export { sendEmail };