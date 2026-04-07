// services/deputyJobNotifier.js
import nodemailer from "nodemailer";

const normaliseBaseUrl = (value = "") => String(value || "").replace(/\/+$/, "");

const DEPUTY_JOB_BCC_EMAIL = String(
  process.env.DEPUTY_JOB_BCC_EMAIL || "hello@thesupremecollective.co.uk"
).trim();

const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM_NAME = String(
  process.env.SMTP_FROM_NAME || "The Supreme Collective"
).trim();
const SMTP_FROM_EMAIL = String(
  process.env.SMTP_FROM_EMAIL || SMTP_USER || "hello@thesupremecollective.co.uk"
).trim();
const SMTP_REPLY_TO = String(
  process.env.SMTP_REPLY_TO || SMTP_FROM_EMAIL || "hello@thesupremecollective.co.uk"
).trim();

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (value) => {
  if (!value) return "TBC";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const getOrdinalSuffix = (day) => {
  const numericDay = Number(day);
  if (!Number.isInteger(numericDay)) return "";
  if (numericDay >= 11 && numericDay <= 13) return "th";

  const lastDigit = numericDay % 10;
  if (lastDigit === 1) return "st";
  if (lastDigit === 2) return "nd";
  if (lastDigit === 3) return "rd";
  return "th";
};

const formatDeputyOpportunityDate = (value) => {
  if (!value) return "";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || "");

  const dayName = parsed.toLocaleDateString("en-GB", { weekday: "long" });
  const monthName = parsed.toLocaleDateString("en-GB", { month: "long" });
  const dayOfMonth = parsed.getDate();
  const year = parsed.getFullYear();

  return `${dayName} ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)} of ${monthName} ${year}`;
};

const formatEmailSubject = (job = {}) => {
  const safeTitle = String(
    job?.title || job?.instrument || "Deputy opportunity"
  ).trim();
  const formattedDate = formatDeputyOpportunityDate(
    job?.eventDate || job?.date || ""
  );

  return formattedDate
    ? `${safeTitle} | Deputy Opportunity for ${formattedDate}`
    : `${safeTitle} | Deputy Opportunity`;
};

const formatFee = (value) => {
  if (value === undefined || value === null || value === "") return "TBC";

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);

  return `£${numeric.toFixed(2).replace(/\.00$/, "")}`;
};

const buildLocation = (job = {}) =>
  job.locationName ||
  job.venue ||
  job.venueName ||
  job.location ||
  job.county ||
  job.postcode ||
  "TBC";

const buildTime = (job = {}) => {
  const start = job.startTime || job.callTime || "TBC";
  const end = job.endTime || job.finishTime || "";
  return end ? `${start} – ${end}` : start;
};

const buildTransporter = () => {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      "Missing SMTP configuration. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS"
    );
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

const buildHtmlEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName ? escapeHtml(musician.firstName) : "there";
  const safeTitle = escapeHtml(job?.title || job?.instrument || "Deputy opportunity");
  const instrument = escapeHtml(job?.instrument || job?.title || "TBC");
  const date = escapeHtml(formatDate(job?.eventDate || job?.date));
  const time = escapeHtml(buildTime(job));
  const location = escapeHtml(buildLocation(job));
  const fee = escapeHtml(formatFee(job?.fee));
  const notes = job?.notes
    ? `<li><strong>Notes:</strong> ${escapeHtml(job.notes)}</li>`
    : "";
  const safeApplyUrl = escapeHtml(applyUrl);

  return `
    <div style="margin:0; padding:0; background:#f7f7f7; font-family:Arial, sans-serif; color:#111;">
      <div style="max-width:700px; margin:0 auto; padding:32px 20px;">
        <div style="background:#111; border-radius:20px 20px 0 0; padding:28px 32px; text-align:left;">
          <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700;">
            The Supreme Collective
          </p>
          <h1 style="margin:12px 0 0; font-size:28px; line-height:1.2; color:#fff;">
            Deputy Opportunity
          </h1>
          <p style="margin:12px 0 0; font-size:15px; line-height:1.6; color:#f3f3f3;">
            A new opportunity has come in that may be a great fit for you.
          </p>
        </div>

        <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 20px 20px; padding:32px;">
          <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#333;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
            A new deputy opportunity has just come in that may be a fit for you. Please review the details below and use the button to apply.
          </p>

          <h2 style="margin:0 0 8px; font-size:24px; line-height:1.3; color:#111;">
            ${safeTitle}
          </h2>

          <div style="margin:0 0 24px;">
            <a
              href="${safeApplyUrl}"
              style="display:inline-block; background:#ff6667; color:#fff; text-decoration:none; padding:14px 22px; border-radius:999px; font-size:14px; font-weight:700;"
            >
              View & apply
            </a>
          </div>

          <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
            <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Job details</h3>
            <ul style="margin:0; padding-left:20px; font-size:14px; line-height:1.8; color:#333;">
              <li><strong>Role:</strong> ${instrument}</li>
              <li><strong>Date:</strong> ${date}</li>
              <li><strong>Time:</strong> ${time}</li>
              <li><strong>Location:</strong> ${location}</li>
              <li><strong>Fee:</strong> ${fee}</li>
              ${notes}
            </ul>
          </div>

          <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#555;">
            Sent via <strong>The Supreme Collective</strong> deputy system.
          </p>

          <div style="margin-top:18px; display:grid; gap:12px;">
            <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
              <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                P.S.
              </p>
              <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                Did you know you can also post your own deputy jobs through <strong>The Supreme Collective</strong>? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.
              </p>
            </div>

            <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
              <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                Also...
              </p>
              <p style="margin:0 0 10px; font-size:14px; line-height:1.7; color:#444;">
                Think your act could be a great fit for <strong>The Supreme Collective</strong>? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.
              </p>
              <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                If the button above does not open, copy and paste this link into your browser:<br/>
                <a href="${safeApplyUrl}">${safeApplyUrl}</a>
              </p>
            </div>

            <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
              <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                Apply directly
              </p>
              <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                If the button above does not open, copy and paste this link into your browser:<br/>
                <a href="${safeApplyUrl}">${safeApplyUrl}</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

const buildTextEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName || "there";
  const safeTitle = job?.title || job?.instrument || "Deputy opportunity";
  const instrument = job?.instrument || job?.title || "TBC";
  const date = formatDate(job?.eventDate || job?.date);
  const time = buildTime(job);
  const location = buildLocation(job);
  const fee = formatFee(job?.fee);
  const notes = job?.notes ? `Notes: ${job.notes}` : "";

  return [
    "The Supreme Collective",
    "Deputy Opportunity",
    "",
    `Hi ${firstName},`,
    "",
    "A new deputy opportunity has just come in that may be a fit for you. Please review the details below and use the link to apply.",
    "",
    safeTitle,
    `Role: ${instrument}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Location: ${location}`,
    `Fee: ${fee}`,
    notes,
    "",
    `View & apply: ${applyUrl}`,
    "",
    "P.S. Did you know you can also post your own deputy jobs through The Supreme Collective? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.",
    "P.S. Think your act could be a great fit for The Supreme Collective? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.",
    "",
    "Sent via The Supreme Collective deputy system.",
  ]
    .filter(Boolean)
    .join("\n");
};

export const notifyMusiciansAboutDeputyJob = async ({ job, musicians = [] }) => {
  const results = [];

  const frontendBaseUrl = normaliseBaseUrl(process.env.FRONTEND_URL);
  if (!frontendBaseUrl) {
    throw new Error("Missing FRONTEND_URL");
  }

  const transporter = buildTransporter();

  for (const musician of musicians) {
    const musicianId = musician?._id || musician?.id || null;
    const email = String(musician?.email || "").trim();
    const phone = musician?.phone || musician?.phoneNumber || "";

    try {
      if (!email) {
        results.push({
          musicianId,
          email: "",
          phone,
          channel: "email",
          status: "skipped",
          sentAt: new Date(),
          error: "Missing recipient email",
        });
        continue;
      }

      const applyUrl = `${frontendBaseUrl}/deputy-jobs/${job?._id}`;
      const subject = formatEmailSubject(job);
      const text = buildTextEmail({ musician, job, applyUrl });
      const html = buildHtmlEmail({ musician, job, applyUrl });

      await transporter.sendMail({
        from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
        replyTo: SMTP_REPLY_TO,
        to: email,
        ...(DEPUTY_JOB_BCC_EMAIL ? { bcc: DEPUTY_JOB_BCC_EMAIL } : {}),
        subject,
        text,
        html,
      });

      results.push({
        musicianId,
        email,
        phone,
        channel: "email",
        status: "sent",
        subject,
        previewText: text,
        previewHtml: html,
        sentAt: new Date(),
        error: "",
      });
    } catch (error) {
      results.push({
        musicianId,
        email,
        phone,
        channel: "email",
        status: "failed",
        subject: formatEmailSubject(job),
        previewText: "",
        previewHtml: "",
        sentAt: new Date(),
        error: error.message || "Unknown error",
      });
    }
  }

  return results;
};

export const previewDeputyJobEmail = async ({ job, musician }) => {
  const frontendBaseUrl = normaliseBaseUrl(process.env.FRONTEND_URL);
  const applyUrl = `${frontendBaseUrl}/deputy-jobs/${job?._id}`;

  return {
    subject: formatEmailSubject(job),
    text: buildTextEmail({ musician, job, applyUrl }),
    html: buildHtmlEmail({ musician, job, applyUrl }),
    from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
    replyTo: SMTP_REPLY_TO,
    bcc: DEPUTY_JOB_BCC_EMAIL,
  };
};