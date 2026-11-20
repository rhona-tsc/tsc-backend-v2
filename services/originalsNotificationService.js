import { originalOwnerDisplayName } from "./originalsPolicyService.js";
import { planOriginalsLaunchAudience } from "./originalsLaunchAudienceService.js";
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';

const clean = (value) => String(value || "").trim();

export const collectOriginalsNotificationRecipients = (records = [], preferences = []) =>
  planOriginalsLaunchAudience(records, preferences).recipients;

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

// Re-announcing reconciles the durable queue; it never bypasses sent receipts.
export const sendOriginalProjectApprovedNotifications = async (options = {}) => {
  const { queueOriginalProjectLaunchEmails } = await import('./originalsProjectEmailService.js');
  const result = await queueOriginalProjectLaunchEmails(options);
  return { ...result, attempted: result.eligible, sent: 0, failed: 0 };
};
