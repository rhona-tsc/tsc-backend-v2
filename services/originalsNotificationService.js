import { originalOwnerDisplayName } from "./originalsPolicyService.js";
import musicianModel from "../models/musicianModel.js";
import sendEmail from "../utils/sendEmail.js";
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';

const clean = (value) => String(value || "").trim();
const normaliseEmail = (value) => clean(value).toLowerCase();

const EXACT_PREVIEW_EMAILS = [
  "hello@thesupremecollective.co.uk",
  "rhona@thesupremecollective.co.uk",
  "ewanneilmcintosh@gmail.com",
];

export const PREVIEW_EMAIL_PATTERN = /^(?:tsc[^@]*@gmail\.com|hello@thesupremecollective\.co\.uk|rhona@thesupremecollective\.co\.uk|ewanneilmcintosh@gmail\.com)$/i;

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
  const adminBase = clean(process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk").replace(/\/$/, "");
  const projectUrl = `${adminBase}/originals/${project?._id}`;
  const title = clean(project?.title) || "New Originals project";
  const roles = (project?.requestedRoles || []).map(role => clean(role?.name)).filter(Boolean);
  const genres = (project?.genres || []).map(clean).filter(Boolean);
  return { ...buildOriginalsEmail({
    subject: `New TSC Originals project: ${title}`, heading: 'A new collaboration is open', firstName,
    paragraphs: [`A new TSC Originals collaboration has been approved and is now open: ${title}.`, `Project owner: ${originalOwnerDisplayName(project)}`, ...(genres.length ? [`Genres: ${genres.join(', ')}`] : []), ...(roles.length ? [`Seeking: ${roles.join(', ')}`] : [])],
    buttonUrl: projectUrl, buttonLabel: 'View the project', afterButton: ['Log in to read the full brief and take part.'],
  }), projectUrl };
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
      musicianPreferences: true, opportunityCategory: "originals",
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
