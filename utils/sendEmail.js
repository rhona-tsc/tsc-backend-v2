import nodemailer from "nodemailer";

// Build lazily so env normalization happens before auth is used.
// Prevents pasted app-password issues like "xxxx xxxx xxxx xxxx" or trailing newlines.
let _cachedTransporter = null;
let _cachedKey = "";

const normUser = (v) => String(v || "").trim().toLowerCase();
const normPass = (v) => String(v || "").replace(/\s+/g, ""); // remove ALL whitespace

function getTransporter() {
  const user = normUser(process.env.GMAIL_AVAIL_USER || process.env.EMAIL_USER);
  const pass = normPass(
    process.env.GMAIL_AVAIL_PASS ||
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
      hasUser: Boolean(user),
      hasPass: Boolean(pass),
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

async function sendEmail({
  to,
  cc,
  bcc,
  subject,
  html,
  text,
  from,
  replyTo,
  attachments,
  dryRun = false,
  testMode = false,
  forceTo = null,
  forceCc = null,
  forceBcc = null,
  subjectPrefix = null,
}) {
  console.log("🟣 [sendEmail] called", {
    to,
    cc,
    bcc,
    subject,
    from,
    replyTo,
    dryRun,
    testMode,
    forceTo,
    forceCc,
    forceBcc,
    subjectPrefix,
    hasHtml: Boolean(html),
    hasText: Boolean(text),
    htmlLength: html?.length || 0,
    textLength: text?.length || 0,
    attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
  });

  const effectiveTo = forceTo ?? to;
  const effectiveCc = forceCc ?? cc;
  const effectiveBcc = forceBcc ?? bcc;

  const toArr = [effectiveTo].flat().filter(Boolean);
  const ccArr = [effectiveCc].flat().filter(Boolean);
  const bccArr = [effectiveBcc].flat().filter(Boolean);

  const isEmail = (s) => typeof s === "string" && /\S+@\S+\.\S+/.test(s.trim());

  const recipients = [...new Set([...toArr, ...ccArr].filter(isEmail))];
  const bccRecipients = [...new Set(bccArr.filter(isEmail))];

  console.log("🟣 [sendEmail] recipient parsing", {
    effectiveTo,
    effectiveCc,
    effectiveBcc,
    toArr,
    ccArr,
    bccArr,
    recipients,
    bccRecipients,
  });

  if (!recipients.length && !bccRecipients.length) {
    console.warn("⚠️ [sendEmail] No valid email recipients found. Skipping.", {
      to,
      cc,
      bcc,
      subject,
    });

    return { ok: false, skipped: true, reason: "no_recipients" };
  }

  // If testMode is enabled, force delivery to a safe inbox.
  if (testMode) {
    const fallbackTestTo = String(process.env.TEST_EMAIL_TO || "").trim();
    const safeTo =
      fallbackTestTo ||
      String(process.env.DEFAULT_FROM || "hello@thesupremecollective.co.uk").trim();

    console.log("🧪 [sendEmail] testMode active", {
      fallbackTestTo,
      safeTo,
      originalRecipients,
    });

    toArr.length = 0;
    toArr.push(safeTo);
  }

  const finalSubject = `${subjectPrefix ? String(subjectPrefix) : testMode ? "[TEST]" : ""}${(subjectPrefix || testMode) ? " " : ""}${subject || ""}`.trim();

  const mail = {
    from: (from || process.env.DEFAULT_FROM || "hello@thesupremecollective.co.uk").trim(),
    replyTo: replyTo ? String(replyTo).trim() : undefined,
    to: testMode ? toArr : recipients,
    cc: !testMode && ccArr.length ? [...new Set(ccArr.filter(isEmail))] : undefined,
    bcc: !testMode && bccRecipients.length ? bccRecipients : undefined,
    subject: finalSubject,
    text,
    html,
    attachments:
      Array.isArray(attachments) && attachments.length ? attachments : undefined,
  };

  console.log("🟣 [sendEmail] final mail payload", {
    from: mail.from,
    replyTo: mail.replyTo,
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject: mail.subject,
    hasHtml: Boolean(mail.html),
    hasText: Boolean(mail.text),
    htmlLength: mail.html?.length || 0,
    textLength: mail.text?.length || 0,
    attachmentsCount: Array.isArray(mail.attachments) ? mail.attachments.length : 0,
  });

  if (dryRun) {
    console.log("🧪 [sendEmail] DRY-RUN (no SMTP send)", {
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
    });

    return {
      ok: true,
      dryRun: true,
      recipients,
      bccRecipients,
      mail,
    };
  }

  try {
    const transporter = getTransporter();

    console.log("🟣 [sendEmail] about to call transporter.sendMail");

    const info = await transporter.sendMail(mail);

    console.log("📤 [sendEmail] nodemailer result", {
      messageId: info?.messageId,
      accepted: info?.accepted,
      rejected: info?.rejected,
      response: info?.response,
      envelope: info?.envelope,
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
      stack: err?.stack,
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