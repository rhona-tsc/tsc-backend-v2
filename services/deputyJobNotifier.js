// services/deputyJobNotifier.js
import nodemailer from "nodemailer";

const normaliseBaseUrl = (value = "") => String(value || "").replace(/\/+$/, "");
const DEPUTY_JOB_BCC_EMAIL = "hello@thesupremecollective.co.uk";

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
  const safeTitle = String(job?.title || job?.instrument || "Deputy opportunity").trim();
  const formattedDate = formatDeputyOpportunityDate(job?.eventDate || job?.date || "");

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
  job.locationName || job.venueName || job.county || job.postcode || "TBC";

const buildTime = (job = {}) => {
  const start = job.startTime || "TBC";
  return job.endTime ? `${start} – ${job.endTime}` : start;
};

const buildHtmlEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName ? escapeHtml(musician.firstName) : "there";
  const safeTitle = escapeHtml(job?.title || job?.instrument || "Deputy opportunity");
  const instrument = escapeHtml(job?.instrument || job?.title || "TBC");
  const date = escapeHtml(formatDate(job?.eventDate));
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

          <div style="margin-top:18px; padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
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
  `;
};

const buildTextEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName || "there";
  const safeTitle = job?.title || job?.instrument || "Deputy opportunity";
  const instrument = job?.instrument || job?.title || "TBC";
  const date = formatDate(job?.eventDate);
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
    "Sent via The Supreme Collective deputy system.",
  ]
    .filter(Boolean)
    .join("\n");
};

export const notifyMusiciansAboutDeputyJob = async ({ job, musicians = [] }) => {
  const results = [];

  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    throw new Error("Missing email credentials");
  }

  const frontendBaseUrl = normaliseBaseUrl(process.env.FRONTEND_URL);
  if (!frontendBaseUrl) {
    throw new Error("Missing FRONTEND_URL");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  for (const musician of musicians) {
    const musicianId = musician?._id || musician?.id || null;
    const email = String(musician?.email || "").trim();
    const phone = musician?.phone || "";

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

      await transporter.sendMail({
        from: `"The Supreme Collective" <${process.env.GMAIL_USER}>`,
        to: email,
        bcc: DEPUTY_JOB_BCC_EMAIL,
        subject,
        text: buildTextEmail({ musician, job, applyUrl }),
        html: buildHtmlEmail({ musician, job, applyUrl }),
      });

      results.push({
        musicianId,
        email,
        phone,
        channel: "email",
        status: "sent",
        sentAt: new Date(),
      });
    } catch (error) {
      results.push({
        musicianId,
        email,
        phone,
        channel: "email",
        status: "failed",
        sentAt: new Date(),
        error: error.message || "Unknown error",
      });
    }
  }

  return results;
};