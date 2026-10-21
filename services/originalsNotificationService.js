import musicianModel from "../models/musicianModel.js";
import sendEmail from "../utils/sendEmail.js";
import { buildTscEmailFooter, escapeEmailHtml } from "../utils/tscEmailBranding.js";

const clean = (value) => String(value || "").trim();
const normaliseEmail = (value) => clean(value).toLowerCase();

const EXACT_PREVIEW_EMAILS = [
  "hello@thesupremecollective.co.uk",
  "rhona@thesupremecollective.co.uk",
  "ewanneilmcintosh@gmail.com",
];

const PREVIEW_EMAIL_PATTERN = /^(?:tsc[^@]*@gmail\.com|hello@thesupremecollective\.co\.uk|rhona@thesupremecollective\.co\.uk|ewanneilmcintosh@gmail\.com)$/i;

const FALLBACK_NAMES = new Map([
  ["hello@thesupremecollective.co.uk", "there"],
  ["rhona@thesupremecollective.co.uk", "Rhona"],
  ["ewanneilmcintosh@gmail.com", "Ewan"],
]);

export const isOriginalsPreviewNotificationEmail = (email) =>
  PREVIEW_EMAIL_PATTERN.test(normaliseEmail(email));

export const collectOriginalsNotificationRecipients = (records = []) => {
  const recipients = new Map(
    EXACT_PREVIEW_EMAILS.map((email) => [
      email,
      { email, firstName: FALLBACK_NAMES.get(email) || "there" },
    ]),
  );

  records.forEach((record) => {
    const email = normaliseEmail(record?.email);
    if (!isOriginalsPreviewNotificationEmail(email)) return;
    const firstName = clean(record?.firstName) || recipients.get(email)?.firstName || "there";
    recipients.set(email, { email, firstName });
  });

  return [...recipients.values()].sort((a, b) => a.email.localeCompare(b.email));
};

export const buildOriginalProjectApprovedEmail = ({ project, firstName = "there" } = {}) => {
  const adminBase = clean(
    process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk",
  ).replace(/\/$/, "");
  const projectUrl = `${adminBase}/originals/${project?._id}`;
  const title = clean(project?.title) || "New Originals project";
  const roles = (project?.requestedRoles || []).map((role) => clean(role?.name)).filter(Boolean);
  const genres = (project?.genres || []).map(clean).filter(Boolean);
  const ownerName = project?.ownerAnonymous
    ? clean(project?.ownerCreditName) || "Anonymous"
    : clean(project?.ownerName) || "A TSC musician";
  const subject = `New TSC Originals project: ${title}`;
  const text = [
    `Hi ${firstName || "there"},`,
    "",
    `A new TSC Originals collaboration has been approved and is now open: ${title}.`,
    `Project owner: ${ownerName}`,
    genres.length ? `Genres: ${genres.join(", ")}` : "",
    roles.length ? `Seeking: ${roles.join(", ")}` : "",
    "",
    "Log in to read the full brief and take part:",
    projectUrl,
    "",
    "Warmest wishes,",
    "The Supreme Collective",
  ].filter((line) => line !== "").join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111111;max-width:720px;margin:0 auto;line-height:1.7;">
      <p>Hi ${escapeEmailHtml(firstName || "there")},</p>
      <p>A new <strong>TSC Originals</strong> collaboration has been approved and is now open:</p>
      <div style="margin:20px 0;padding:20px;border:1px solid #ececec;border-radius:16px;">
        <h2 style="margin:0 0 10px;font-size:22px;">${escapeEmailHtml(title)}</h2>
        <p style="margin:0 0 6px;"><strong>Project owner:</strong> ${escapeEmailHtml(ownerName)}</p>
        ${genres.length ? `<p style="margin:0 0 6px;"><strong>Genres:</strong> ${escapeEmailHtml(genres.join(", "))}</p>` : ""}
        ${roles.length ? `<p style="margin:0;"><strong>Seeking:</strong> ${escapeEmailHtml(roles.join(", "))}</p>` : ""}
      </div>
      <p style="text-align:center;margin:24px 0;"><a href="${escapeEmailHtml(projectUrl)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#ff6667;color:#ffffff;text-decoration:none;font-weight:700;">View the project</a></p>
      <p>Log in to read the full brief and take part.</p>
      <p>Warmest wishes,<br /><strong>The Supreme Collective</strong></p>
      ${buildTscEmailFooter({ audience: "musician" })}
    </div>`;

  return { subject, text, html, projectUrl };
};

export const sendOriginalProjectApprovedNotifications = async ({
  project,
  emailSender = sendEmail,
  musicianRepository = musicianModel,
} = {}) => {
  const records = await musicianRepository
    .find({ email: { $regex: PREVIEW_EMAIL_PATTERN } })
    .select("email firstName")
    .lean();
  const recipients = collectOriginalsNotificationRecipients(records);
  const results = await Promise.all(recipients.map(async (recipient) => {
    const message = buildOriginalProjectApprovedEmail({ project, firstName: recipient.firstName });
    const result = await emailSender({
      to: recipient.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return {
      email: recipient.email,
      ok: result?.ok === true,
      messageId: result?.messageId || "",
      error: result?.ok === true ? "" : result?.error || result?.reason || "Email was not accepted",
    };
  }));

  return {
    attempted: results.length,
    sent: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
};
