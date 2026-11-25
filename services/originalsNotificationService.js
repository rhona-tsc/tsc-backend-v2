import { originalOwnerDisplayName } from "./originalsPolicyService.js";
import { planOriginalsLaunchAudience } from "./originalsLaunchAudienceService.js";
import { buildOriginalsEmail, originalsEmailParagraph } from '../utils/originalsEmailTemplate.js';
import { escapeEmailHtml } from '../utils/tscEmailBranding.js';

const clean = (value) => String(value || "").trim();

export const collectOriginalsNotificationRecipients = (records = [], preferences = []) =>
  planOriginalsLaunchAudience(records, preferences).recipients;

export const buildOriginalProjectApprovedEmail = ({ project, firstName = "there", playback = null, guide = null } = {}) => {
  const adminBase = clean(process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk").replace(/\/$/, "");
  const projectUrl = `${adminBase}/originals/${project?._id}`;
  const title = clean(project?.title) || "New Originals project";
  const roles = (project?.requestedRoles || []).map(role => clean(role?.name)).filter(Boolean);
  const genres = (project?.genres || []).map(clean).filter(Boolean);
  const intro = `A new TSC Originals collaboration has been approved and is now open: ${title}.`;
  const details = [
    ['PROJECT OWNER', originalOwnerDisplayName(project)],
    ...(genres.length ? [['GENRE', genres.join(', ')]] : []),
    ...(roles.length ? [['RECORDING ORDER', roles.map((role, index) => `${index + 1}. ${role}`).join('  •  ')]] : []),
  ];
  const guideHtml = playback ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background:#111111;border-radius:14px;"><tr><td style="padding:22px;">
<p style="margin:0 0 5px;color:#ff8585;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;">GUIDE RECORDING</p>
<p style="margin:0 0 16px;color:#ffffff;font-size:18px;line-height:25px;font-weight:700;">${escapeEmailHtml(title)}</p>
<audio controls preload="none" style="display:block;width:100%;margin:0 0 16px;"><source src="${escapeEmailHtml(playback.audioUrl)}" type="${escapeEmailHtml(guide?.mimeType || 'audio/mpeg')}"></audio>
<p style="margin:0 0 16px;color:#d1d5db;font-size:13px;line-height:20px;">If the player is hidden by your email app, use the button below.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ff6667" style="border-radius:8px;text-align:center;"><a href="${escapeEmailHtml(playback.listenUrl)}" style="display:inline-block;padding:12px 19px;color:#111111;text-decoration:none;font-size:15px;line-height:22px;font-weight:700;">&#9654;&nbsp; Play the guide track</a></td></tr></table>
</td></tr></table>` : '';
  const bodyHtml = `${originalsEmailParagraph(intro)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border:1px solid #e5e7eb;border-radius:12px;">${details.map(([label, value], index) => `<tr><td style="padding:13px 15px;${index ? 'border-top:1px solid #e5e7eb;' : ''}"><p style="margin:0 0 3px;color:#777777;font-size:10px;line-height:15px;font-weight:700;letter-spacing:1.2px;">${escapeEmailHtml(label)}</p><p style="margin:0;color:#111111;font-size:15px;line-height:22px;">${escapeEmailHtml(value)}</p></td></tr>`).join('')}</table>
${guideHtml}
${originalsEmailParagraph('The vocal is a guide and will be rerecorded. The lyrics and melody are the direction we expect to keep.')}`;
  return { ...buildOriginalsEmail({
    subject: `New TSC Originals project: ${title}`, heading: 'A new collaboration is open', firstName,
    bodyHtml,
    bodyText: [intro, `Project owner: ${originalOwnerDisplayName(project)}`, ...(genres.length ? [`Genres: ${genres.join(', ')}`] : []), ...(roles.length ? [`Recording order: ${roles.map((role, index) => `${index + 1}. ${role}`).join(', ')}`] : []), ...(playback ? [`Play the guide recording: ${playback.listenUrl}`] : []), 'The vocal is a guide and will be rerecorded. The lyrics and melody are the direction we expect to keep.'].join('\n\n'),
    buttonUrl: projectUrl, buttonLabel: 'View the project', afterButton: ['Log in to read the full brief and take part.'],
  }), projectUrl };
};

// Re-announcing reconciles the durable queue; it never bypasses sent receipts.
export const sendOriginalProjectApprovedNotifications = async (options = {}) => {
  const { queueOriginalProjectLaunchEmails } = await import('./originalsProjectEmailService.js');
  const result = await queueOriginalProjectLaunchEmails(options);
  return { ...result, attempted: result.eligible, sent: 0, failed: 0 };
};
