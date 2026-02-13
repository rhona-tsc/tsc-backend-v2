import nodemailer from "nodemailer";

const clean = (v) => {
  if (v == null) return "";
  // strips wrapping quotes and trims
  return String(v).trim().replace(/^["']|["']$/g, "");
};

export function getSmtpConfig() {
  const host = clean(process.env.SMTP_HOST);
  const port = Number(clean(process.env.SMTP_PORT) || 587);

  // Prefer SMTP_* first (your OTP mailer should use these),
  // then fall back to EMAIL_* or GMAIL_* if you’ve historically used those.
  const user =
    clean(process.env.SMTP_USER) ||
    clean(process.env.EMAIL_USER) ||
    clean(process.env.GMAIL_USER) ||
    clean(process.env.GMAIL_AVAIL_USER);

  const pass =
    clean(process.env.SMTP_PASS) ||
    clean(process.env.EMAIL_PASS) ||
    clean(process.env.GMAIL_PASS) ||
    clean(process.env.GMAIL_AVAIL_PASS);

  const from =
    clean(process.env.EMAIL_FROM) ||
    (clean(process.env.SMTP_FROM_NAME)
      ? `${clean(process.env.SMTP_FROM_NAME)} <${user}>`
      : "") ||
    `TSC <${user || "hello@thesupremecollective.co.uk"}>`;

  return { host, port, user, pass, from };
}

export function getTransporter() {
  const { host, port, user, pass } = getSmtpConfig();

  // Helpful debug (does NOT print the password)
  console.log("📮 [smtp] snapshot", {
    host,
    port,
    user: user || null,
    passLen: pass ? pass.length : 0,
  });

  if (!host) throw new Error("SMTP_HOST missing");
  if (!user) throw new Error("SMTP_USER/EMAIL_USER/GMAIL_USER missing");
  if (!pass) throw new Error("SMTP_PASS/EMAIL_PASS/GMAIL_PASS missing");

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}