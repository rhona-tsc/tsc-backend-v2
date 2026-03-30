// services/deputyJobNotifier.js
import nodemailer from "nodemailer";

const normaliseBaseUrl = (value = "") => String(value || "").replace(/\/+$/, "");

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
  const role = escapeHtml(job?.title || job?.instrument || "Deputy opportunity");
  const instrument = escapeHtml(job?.instrument || job?.title || "TBC");
  const date = escapeHtml(formatDate(job?.eventDate));
  const time = escapeHtml(buildTime(job));
  const location = escapeHtml(buildLocation(job));
  const fee = escapeHtml(formatFee(job?.fee));
  const notes = job?.notes ? `<p style="margin:0 0 16px;"><strong>Notes:</strong> ${escapeHtml(job.notes)}</p>` : "";
  const safeApplyUrl = escapeHtml(applyUrl);

  return `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.6;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 16px;">New deputy opportunity</h2>
      <p style="margin:0 0 16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">A new deputy opportunity has just come in that may be a fit for you.</p>
      <p style="margin:0 0 8px;"><strong>Role:</strong> ${instrument}</p>
      <p style="margin:0 0 8px;"><strong>Job:</strong> ${role}</p>
      <p style="margin:0 0 8px;"><strong>Date:</strong> ${date}</p>
      <p style="margin:0 0 8px;"><strong>Time:</strong> ${time}</p>
      <p style="margin:0 0 8px;"><strong>Location:</strong> ${location}</p>
      <p style="margin:0 0 16px;"><strong>Fee:</strong> ${fee}</p>
      ${notes}
      <p style="margin:24px 0;">
        <a
          href="${safeApplyUrl}"
          style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600;"
        >
          View & apply
        </a>
      </p>
      <p style="margin:0 0 8px;">Or copy and paste this link into your browser:</p>
      <p style="margin:0 0 16px;"><a href="${safeApplyUrl}">${safeApplyUrl}</a></p>
      <p style="margin:0;">The Supreme Collective</p>
    </div>
  `;
};

const buildTextEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName || "there";
  const role = job?.title || job?.instrument || "Deputy opportunity";
  const instrument = job?.instrument || job?.title || "TBC";
  const date = formatDate(job?.eventDate);
  const time = buildTime(job);
  const location = buildLocation(job);
  const fee = formatFee(job?.fee);
  const notes = job?.notes ? `\nNotes: ${job.notes}` : "";

  return [
    `Hi ${firstName},`,
    "",
    "A new deputy opportunity has just come in that may be a fit for you.",
    "",
    `Role: ${instrument}`,
    `Job: ${role}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Location: ${location}`,
    `Fee: ${fee}`,
    notes,
    "",
    `View and apply: ${applyUrl}`,
    "",
    "The Supreme Collective",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
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
      const subject = `Deputy opportunity: ${job?.title || job?.instrument || "New role"}`;

      await transporter.sendMail({
        from: `"The Supreme Collective" <${process.env.GMAIL_USER}>`,
        to: email,
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