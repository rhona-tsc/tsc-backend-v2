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

const SMTP_RATE_LIMIT_DELAY_MS = Number(
  process.env.SMTP_RATE_LIMIT_DELAY_MS || 750
);
const SMTP_BATCH_SIZE = Number(process.env.SMTP_BATCH_SIZE || 20);
const SMTP_BATCH_PAUSE_MS = Number(process.env.SMTP_BATCH_PAUSE_MS || 10000);

const delay = (ms = 0) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));


const buildLocation = (job = {}) =>
  job.location ||
  job.locationName ||
  job.venue ||
  job.venueName ||
  [job.venue, job.locationName, job.county, job.postcode]
    .filter(Boolean)
    .join(", ") ||
  job.county ||
  job.postcode ||
  "TBC";

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

const getDeputyFeeForEmail = (job = {}) => {
  const deputyNetAmount = Number(job?.deputyNetAmount);
  if (Number.isFinite(deputyNetAmount) && deputyNetAmount > 0) {
    return deputyNetAmount;
  }

  const fee = Number(job?.fee);
  if (Number.isFinite(fee) && fee > 0) {
    return fee;
  }

  return job?.deputyNetAmount ?? job?.fee ?? "";
};


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
    pool: true,
    maxConnections: 1,
    maxMessages: Infinity,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

const buildHtmlEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName
    ? escapeHtml(musician.firstName)
    : "there";
  const safeTitle = escapeHtml(
    job?.title || job?.instrument || "Deputy opportunity",
  );
  const instrument = escapeHtml(job?.instrument || job?.title || "TBC");
  const date = escapeHtml(formatDate(job?.eventDate || job?.date));
  const time = escapeHtml(buildTime(job));
  const location = escapeHtml(buildLocation(job));
  const fee = escapeHtml(
    formatFee(getDeputyFeeForEmail(job), job?.currency || "GBP"),
  );
  const notes = job?.notes
    ? `<li style="margin:0 0 8px;"><strong>Notes:</strong> ${escapeHtml(job.notes)}</li>`
    : "";
  const safeApplyUrl = escapeHtml(applyUrl);

  const WEBSITE_URL = "https://thesupremecollective.co.uk";
  const ADMIN_URL = "https://admin.thesupremecollective.co.uk";
  const INSTAGRAM_URL = "https://instagram.com/thesupremecollective";
  const YOUTUBE_URL =
    "https://www.youtube.com/channel/UC6HhRZA4XLVajrz5vk5vn2A";
  const GOOGLE_REVIEWS_URL =
    "https://www.google.com/search?q=the+supreme+collective&oq=the+supreme+collective&aqs=chrome.0.0i355i512j46i175i199i512j0i22i30l3j69i60j69i61l2.4878j0j7&sourceid=chrome&ie=UTF-8#lrd=0x751df2ff4f2e30d:0xb1f44d25caa515eb,1,,,";
  const INSTAGRAM_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/instagram-icon_rtespa.png";
  const YOUTUBE_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/1_lo9yf6.png";
  const GOOGLE_REVIEWS_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777059616/google-icon2_wc33od.png";
  const WEBSITE_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777207820/website-icon_nuahjk.png";
  const UNSUBSCRIBE_SUBJECT = encodeURIComponent(
    "Please unsubscribe me from The Supreme Collective",
  );
  const UNSUBSCRIBE_BODY = encodeURIComponent(
    "Please hit send to unsubscribe from The Supreme Collective",
  );
  const UNSUBSCRIBE_URL = `mailto:hello@thesupremecollective.co.uk?subject=${UNSUBSCRIBE_SUBJECT}&body=${UNSUBSCRIBE_BODY}`;

  const POST_JOB_IMAGE_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045523/post-your-own-dep-jobs_l0jy6s.png";
  const LIST_ACT_IMAGE_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045541/wanna-list-your-act_mrnyse.png";
  const SIGN_OFF_GIF_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045559/TSC_Signature_2026_svgxr5.gif";

  const shareText = encodeURIComponent(
    `I thought this deputy opportunity might be a great fit for you: ${applyUrl}`,
  );
  const whatsappShareUrl = `https://wa.me/?text=${shareText}`;
  const mailtoShareUrl = `mailto:?subject=${encodeURIComponent(
    `Deputy opportunity: ${job?.title || job?.instrument || "Deputy opportunity"}`,
  )}&body=${shareText}`;
  // const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(applyUrl)}`;

  return `
    <div style="margin:0; padding:0; background:#f3f4f6; font-family:Arial, Helvetica, sans-serif; color:#111111;">
      <div style="max-width:720px; margin:0 auto; padding:28px 16px;">

        <div style="background:#111111; border-radius:28px 28px 0 0; overflow:hidden; text-align:center;">
          <div style="padding:18px 28px 8px;">
            <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700; text-align:center;">
              The Supreme Collective
            </p>
          </div>

          <div style="padding:0 28px 30px; text-align:center;">
            <h1 style="margin:8px 0 10px; font-size:34px; line-height:1.05; color:#ffffff; font-weight:800;">
              Deputy Opportunity
            </h1>
            <p style="margin:0; font-size:16px; line-height:1.7; color:#f3f3f3;">
              A new opportunity has come in that may be a great fit for you.
            </p>
          </div>
        </div>

        <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 28px 28px; padding:30px 28px; box-shadow:0 10px 30px rgba(0,0,0,0.04);">
          <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#333333;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 22px; font-size:15px; line-height:1.8; color:#444444;">
            A new deputy opportunity has just come in that may be a fit for you. Please review the details below and use the button to apply.
          </p>

          <div style="margin:0 0 22px; padding:22px; background:#fff6f6; border:1px solid #ffd6d7; border-radius:22px;">
            <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#ff6667; font-weight:700;">
              Role
            </p>
            <h2 style="margin:0; font-size:30px; line-height:1.15; color:#111111; font-weight:800;">
              ${instrument}
            </h2>
          </div>

          <div style="margin:0 0 26px; text-align:center;">
            <a
              href="${safeApplyUrl}"
              style="display:inline-block; background:#ff6667; color:#ffffff; text-decoration:none; padding:14px 24px; border-radius:999px; font-size:16px; font-weight:700;"
            >
              View & apply
            </a>
          </div>

          <div style="margin-bottom:28px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:22px;">
            <h3 style="margin:0 0 14px; font-size:16px; color:#111111;">Job details</h3>
            <ul style="margin:0; padding-left:20px; font-size:14px; line-height:1.8; color:#333333;">
              <li style="margin:0 0 8px;"><strong>Role:</strong> ${instrument}</li>
              <li style="margin:0 0 8px;"><strong>Date:</strong> ${date}</li>
              <li style="margin:0 0 8px;"><strong>Time:</strong> ${time}</li>
              <li style="margin:0 0 8px;"><strong>Location:</strong> ${location}</li>
              <li style="margin:0 0 8px;"><strong>Deputy fee:</strong> ${fee}</li>
              ${notes}
            </ul>
          </div>

          <div style="margin:0 0 28px; padding:22px; background:#111111; border-radius:22px;">
            <h3 style="margin:0 0 10px; font-size:18px; color:#ffffff;">Share this opportunity</h3>
            <p style="margin:0 0 18px; font-size:14px; line-height:1.7; color:#f3f3f3;">
              Know someone who could be a brilliant fit? Feel free to share this opportunity with them.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="33.33%" style="padding:0 8px 10px 0; text-align:center;">
                  <a
                    href="${whatsappShareUrl}"
                    style="display:block; width:100%; box-sizing:border-box; background:#25D366; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:999px; font-size:15px; font-weight:700; text-align:center;"
                  >
                    Share on WhatsApp
                  </a>
                </td>
                <td width="33.33%" style="padding:0 8px 10px 8px; text-align:center;">
                  <a
                    href="${mailtoShareUrl}"
                    style="display:block; width:100%; box-sizing:border-box; background:#ffffff; color:#111111; text-decoration:none; padding:12px 18px; border-radius:999px; font-size:15px; font-weight:700; text-align:center;"
                  >
                    Share by email
                  </a>
                </td>
                <td width="33.33%" style="padding:0 0 10px 8px; text-align:center;">
                  <a
                    href="${safeApplyUrl}"
                    style="display:block; width:100%; box-sizing:border-box; background:transparent; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:999px; font-size:15px; font-weight:700; text-align:center; border:1px solid rgba(255,255,255,0.35);"
                  >
                    Copy job link
                  </a>
                </td>
              </tr>
            </table>
          </div>


          <div style="margin:28px 0 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="50%" style="padding-right:10px;">
                  <a href="${WEBSITE_URL}" style="text-decoration:none; display:block;">
                    <img
                      src="${POST_JOB_IMAGE_URL}"
                      alt="Post your own deputy jobs"
                      style="display:block; width:100%; max-width:328px; border:0; border-radius:20px;"
                    />
                  </a>
                </td>
                <td valign="top" width="50%" style="padding-left:10px;">
                  <a href="${WEBSITE_URL}" style="text-decoration:none; display:block;">
                    <img
                      src="${LIST_ACT_IMAGE_URL}"
                      alt="Wanna list your act?"
                      style="display:block; width:100%; max-width:328px; border:0; border-radius:20px;"
                    />
                  </a>
                </td>
              </tr>
              <tr>
                <td valign="top" width="50%" style="padding:16px 10px 0 0;">
                  <div style="padding:0; background:transparent; border:0; border-radius:0; height:100%; box-sizing:border-box;">
                    <p style="margin:0; font-size:14px; line-height:1.7; color:#444444;">
                      Did you know you can also post your own deputy jobs through <strong>The Supreme Collective</strong>? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.
                    </p>
                  </div>
                </td>
                <td valign="top" width="50%" style="padding:16px 0 0 10px;">
                  <div style="padding:0; background:transparent; border:0; border-radius:0; height:100%; box-sizing:border-box;">
                    <p style="margin:0; font-size:14px; line-height:1.7; color:#444444;">
                      Think your act could be a great fit for <strong>The Supreme Collective</strong>? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.
                    </p>
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <p style="margin:0 0 18px; font-size:15px; line-height:1.7; color:#444444;">
            Thanks so much for considering this opportunity. Currently our matching system is under development and intentionally loose while musicians on The Books update their profiles over the coming months. This is to ensure people don't miss out on deputy opportunities that suit them. We will be tightening up our matching system in due course, and encourage you to update your profile to make sure you still get deputy notifications revelant to your skills. Thanks again, and we look forward to working with you!
          </p>
          <p style="margin:0 0 18px; font-size:15px; line-height:1.7; color:#444444;">
            Best wishes,<br />
            <strong>The Supreme Collective</strong>
          </p>

        

          <div style="margin:0 0 8px; padding:22px; background:#fafafa; border:1px solid #ececec; border-radius:22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
              <tr>
                <td style="vertical-align:middle; text-align:left;">
                  <h3 style="margin:0; font-size:16px; color:#111111;">Find us online</h3>
                </td>
                <td style="vertical-align:middle; text-align:right; white-space:nowrap; padding-left:24px;">
                  <a href="${GOOGLE_REVIEWS_URL}" style="text-decoration:none; display:inline-block; margin-left:auto;">
                    <img
                      src="${GOOGLE_REVIEWS_ICON_URL}"
                      alt="Google reviews"
                      style="display:block; width:192px; height:48px; border:0; object-fit:contain; margin-left:auto;"
                    />
                  </a>
                </td>
              </tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
              <tr>
                <td style="padding:0 14px 10px 0; vertical-align:middle;">
                  <a href="${INSTAGRAM_URL}" style="text-decoration:none; display:inline-block;">
                    <img
                      src="${INSTAGRAM_ICON_URL}"
                      alt="Instagram"
                      style="display:block; width:32px; height:32px; border:0;"
                    />
                  </a>
                </td>
                <td style="padding:0 14px 10px 0; vertical-align:middle;">
                  <a href="${YOUTUBE_URL}" style="text-decoration:none; display:inline-block;">
                    <img
                      src="${YOUTUBE_ICON_URL}"
                      alt="YouTube"
                      style="display:block; width:32px; height:32px; border:0;"
                    />
                  </a>
                </td>
                <td style="padding:0 14px 10px 0; vertical-align:middle;">
                  <a href="${WEBSITE_URL}" style="text-decoration:none; display:inline-block;">
                    <img
                      src="${WEBSITE_ICON_URL}"
                      alt="Website"
                      style="display:block; width:32px; height:32px; border:0;"
                    />
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px; font-size:14px; line-height:1.7; color:#555555;">
              Keep your profile up to date by signing in here:
              <a href="${ADMIN_URL}" style="color:#ff6667; text-decoration:none; font-weight:700;"> admin.thesupremecollective.co.uk</a>
            </p>

            <div style="padding-top:16px; border-top:1px solid #e3e3e3;">
              <p style="margin:0 0 8px; font-size:12px; line-height:1.7; color:#777777;">
                Copyright © 2026 The Supreme Collective Ltd. All rights reserved.
              </p>
              <p style="margin:0 0 8px; font-size:12px; line-height:1.7; color:#777777;">
                Registered Office: 71-75, Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom | Company Number: 16883956
              </p>
              <p style="margin:0; font-size:12px; line-height:1.7; color:#777777;">
                <a href="${UNSUBSCRIBE_URL}" style="color:#ff6667; text-decoration:none; font-weight:700;">Unsubscribe</a>
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
  const fee = formatFee(getDeputyFeeForEmail(job), job?.currency || "GBP");
  const notes = job?.notes ? `Notes: ${job.notes}` : "";

  const WEBSITE_URL = "https://thesupremecollective.co.uk";
  const ADMIN_URL = "https://admin.thesupremecollective.co.uk";
  const INSTAGRAM_URL = "https://instagram.com/thesupremecollective";
  const YOUTUBE_URL = "https://www.youtube.com/channel/UC6HhRZA4XLVajrz5vk5vn2A";
  const GOOGLE_REVIEWS_URL =
    "https://www.google.com/search?q=the+supreme+collective&oq=the+supreme+collective&aqs=chrome.0.0i355i512j46i175i199i512j0i22i30l3j69i60j69i61l2.4878j0j7&sourceid=chrome&ie=UTF-8#lrd=0x751df2ff4f2e30d:0xb1f44d25caa515eb,1,,,";
  const UNSUBSCRIBE_URL =
    "mailto:hello@thesupremecollective.co.uk?subject=Please%20unsubscribe%20me%20from%20The%20Supreme%20Collective&body=Please%20hit%20send%20to%20unsubscribe%20from%20The%20Supreme%20Collective";

  const shareText = encodeURIComponent(
    `I thought this deputy opportunity might be a great fit for you: ${applyUrl}`,
  );
  const whatsappShareUrl = `https://wa.me/?text=${shareText}`;
  const mailtoShareUrl = `mailto:?subject=${encodeURIComponent(
    `Deputy opportunity: ${job?.title || job?.instrument || "Deputy opportunity"}`,
  )}&body=${shareText}`;
  // const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(applyUrl)}`;

  return [
    "THE SUPREME COLLECTIVE",
    "DEPUTY OPPORTUNITY",
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
    `Deputy fee: ${fee}`,
    notes,
    "",
    `View & apply: ${applyUrl}`,
    "",
    "Share this opportunity with someone you think would be a great fit:",
    `WhatsApp: ${whatsappShareUrl}`,
    `Email: ${mailtoShareUrl}`,
    `Copy job link: ${applyUrl}`,
    "",
    "Did you know you can also post your own deputy jobs through The Supreme Collective? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.",
    "",
    "Think your act could be a great fit for The Supreme Collective? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.",
    "",
    `Update your profile: ${ADMIN_URL}`,
    `Website: ${WEBSITE_URL}`,
    `Instagram: ${INSTAGRAM_URL}`,
    `YouTube: ${YOUTUBE_URL}`,
    `Google reviews: ${GOOGLE_REVIEWS_URL}`,
    "",
    "Best wishes,\nThe Supreme Collective",
    "",
    "Copyright © 2026 The Supreme Collective Ltd. All rights reserved.",
    "Registered Office: 71-75, Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom | Company Number: 16883956",
    `Unsubscribe: ${UNSUBSCRIBE_URL}`,
  ]
    .filter(Boolean)
    .join("\n");
};

export const notifyMusiciansAboutDeputyJob = async ({ job, musicians = [] }) => {
  const results = [];
  let hasSentBccCopy = false;

  const frontendBaseUrl = normaliseBaseUrl(process.env.ADMIN_FRONTEND_URL);
  if (!frontendBaseUrl) {
    throw new Error("Missing ADMIN_FRONTEND_URL");
  }

  const transporter = buildTransporter();
  let sentSincePause = 0;

  try {
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
        const shouldBccThisEmail = Boolean(DEPUTY_JOB_BCC_EMAIL) && !hasSentBccCopy;

        await transporter.sendMail({
          from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
          replyTo: SMTP_REPLY_TO,
          to: email,
          ...(shouldBccThisEmail ? { bcc: DEPUTY_JOB_BCC_EMAIL } : {}),
          subject,
          text,
          html,
        });

        if (shouldBccThisEmail) {
          hasSentBccCopy = true;
        }

        sentSincePause += 1;

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

        if (SMTP_RATE_LIMIT_DELAY_MS > 0) {
          await delay(SMTP_RATE_LIMIT_DELAY_MS);
        }

        if (
          SMTP_BATCH_SIZE > 0 &&
          SMTP_BATCH_PAUSE_MS > 0 &&
          sentSincePause >= SMTP_BATCH_SIZE
        ) {
          await delay(SMTP_BATCH_PAUSE_MS);
          sentSincePause = 0;
        }
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
  } finally {
    await transporter.close();
  }
};

export const previewDeputyJobEmail = async ({ job, musician }) => {
  const frontendBaseUrl = normaliseBaseUrl(process.env.ADMIN_FRONTEND_URL);
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