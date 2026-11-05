import crypto from 'node:crypto';
import Referral from '../models/originalReferralModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Asset from '../models/originalAssetModel.js';
import Issue from '../models/originalIssueModel.js';
import Credit from '../models/originalCreditVersionModel.js';
import { loadOriginalMembership, originalParticipation } from './originalsMembershipService.js';
import { originalRoleProgress } from './originalsRoleProgressService.js';
import { getOriginalsUserId, isOriginalsEnabled } from './originalsPolicyService.js';
import { escapeEmailHtml, buildTscEmailFooter, buildTscEmailFooterText } from '../utils/tscEmailBranding.js';
import sendEmail from '../utils/sendEmail.js';
export const referralHash = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const key = value => String(value || '').trim().toLowerCase();

export async function claimedOriginalReferral(projectId, musicianId) {
  return Boolean(await Referral.exists({ projectId, musicianId, claimedAt: { $ne: null } }));
}

export async function allowOriginalReferralRequest(req) {
  if (!isOriginalsEnabled()) return false;
  const musicianId = getOriginalsUserId(req.user);
  if (!musicianId) return false;
  const direct = req.path.match(/^\/projects\/([a-f\d]{24})(?:\/|$)/i);
  let projectId = direct?.[1];
  if (/\/referrals\/claim\/?$/.test(req.path)) {
    if (projectId && await claimedOriginalReferral(projectId, musicianId)) return true;
    if (!projectId || !/^[a-f\d]{64}$/i.test(req.body?.token || '')) return false;
    const profile = await Musician.findById(musicianId).select('email').lean();
    return Boolean(profile?.email && await Referral.exists({ projectId, email: key(profile.email), tokenHash: referralHash(req.body.token), expiresAt: { $gt: new Date() }, claimedAt: null }));
  }
  if (req.path === '/projects' && req.method === 'GET') {
    const referrals = await Referral.find({ musicianId, claimedAt: { $ne: null } }).select('projectId roleName').lean();
    req.originalReferralGrants = referrals;
    req.originalReferralProjectIds = referrals.map(item => item.projectId);
    return referrals.length > 0;
  }
  if (!projectId) {
    const resource = req.path.match(/^\/(rounds|reservations|submissions|assets|issues|credit-versions)\/([^/]+)/);
    const models = { rounds: Round, reservations: Reservation, submissions: Submission, assets: Asset, issues: Issue, 'credit-versions': Credit };
    if (resource) projectId = (await models[resource[1]].findById(resource[2]).select('projectId').lean())?.projectId;
  }
  if (!projectId) return false;
  const grants = await Referral.find({ projectId, musicianId, claimedAt: { $ne: null } }).select('roleName').lean();
  if (grants.length) req.originalReferralRoles = grants.map(item => item.roleName);
  return grants.length > 0;
}

export const buildOriginalReferralEmail = ({ referral, project, token }) => {
  const base = String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '');
  const url = `${base}/originals/${project._id}?referral=${encodeURIComponent(token)}`;
  const brief = String(project.description || '').trim();
  const encouragement = `Follow ${referral.referrerName}’s recommendation as soon as you can to make sure you don’t miss out on this opportunity to contribute!`;
  const signIn = 'Sign in using this email address, or create an account if you’re new to TSC.';
  const text = `Hi ${referral.fullName},\n\n${referral.referrerName} saw this original project “${project.title}”, which is looking for someone to fill the role of “${referral.roleName}”, and thought you might be a great fit.\n\nProject brief\n${brief || 'Read the project brief in the workspace.'}\n\n${encouragement}\n\nView the project and take part:\n${url}\n\n${signIn}\n\nWarmest wishes,\nThe Supreme Collective\n\n${buildTscEmailFooterText()}`;
  return {
    to: referral.email,
    subject: `${referral.referrerName} recommended you for ${referral.roleName}`,
    text,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A project recommendation for you</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
    <!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;">
      <tr><td style="padding:26px 24px;background:#111111;border-radius:20px 20px 0 0;">
        <p style="margin:0 0 12px;font-size:12px;line-height:18px;letter-spacing:2px;font-weight:700;color:#ff8585;">TSC ORIGINALS</p>
        <h1 style="margin:0;font-size:28px;line-height:35px;color:#ffffff;">A project recommendation for you</h1>
      </td></tr>
      <tr><td style="padding:28px 24px;word-break:break-word;overflow-wrap:anywhere;">
        <p style="margin:0 0 18px;font-size:16px;line-height:26px;">Hi ${escapeEmailHtml(referral.fullName)},</p>
        <p style="margin:0 0 22px;font-size:16px;line-height:26px;color:#444444;">${escapeEmailHtml(referral.referrerName)} saw this original project <strong>“${escapeEmailHtml(project.title)}”</strong>, which is looking for someone to fill the role of <strong>“${escapeEmailHtml(referral.roleName)}”</strong>, and thought you might be a great fit.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:18px;word-break:break-word;overflow-wrap:anywhere;">
          <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#666666;">PROJECT</p>
          <h2 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#111111;">${escapeEmailHtml(project.title)}</h2>
          <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#444444;">Role: <strong>${escapeEmailHtml(referral.roleName)}</strong></p>
          <h3 style="margin:0 0 8px;font-size:16px;line-height:24px;color:#111111;">Project brief</h3>
          <p style="margin:0;font-size:15px;line-height:25px;color:#444444;">${escapeEmailHtml(brief || 'Read the project brief in the workspace.').replace(/\r\n|\r|\n/g, '<br>')}</p>
        </td></tr></table>
        <p style="margin:22px 0 0;font-size:16px;line-height:26px;color:#444444;">${escapeEmailHtml(encouragement)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#ff6667" style="border-radius:8px;text-align:center;">
          <a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:14px 24px;font-size:16px;line-height:24px;font-weight:700;color:#111111;text-decoration:none;">View the project and take part</a>
        </td></tr></table>
        <p style="margin:0 0 24px;font-size:13px;line-height:21px;color:#666666;">${escapeEmailHtml(signIn)}</p>
        <p style="margin:0;font-size:15px;line-height:25px;color:#444444;">Warmest wishes,<br><strong>The Supreme Collective</strong></p>
        ${buildTscEmailFooter({ audience: 'musician' })}
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`,
  };
};

export async function deliverOriginalReferrals({ referralId, emailSender = sendEmail, limit = 20, now = new Date() } = {}) {
  if (!isOriginalsEnabled()) return;
  for (let i = 0; i < limit; i++) {
    const referral = await Referral.findOneAndUpdate({ ...(referralId ? { _id: referralId } : {}), $or: [{ emailState: 'queued', sendAfter: { $lte: now } }, { emailState: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { emailState: 'sending', leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) }, $inc: { attempts: 1 } }, { new: true }).lean();
    if (!referral) break;
    let tokenHash;
    try {
      const project = await Project.findById(referral.projectId).lean();
      const membership = project && await loadOriginalMembership(project);
      const eligible = membership && originalParticipation(membership, referral.referrerId).canAccess && originalRoleProgress(membership).some(role => key(role.name) === key(referral.roleName) && role.canRecommend);
      if (!eligible || referral.expiresAt <= now || ['cancelled','archived'].includes(project.state)) { await Referral.updateOne({ _id: referral._id }, { $set: { emailState: 'cancelled' } }); continue; }
      const token = crypto.randomBytes(32).toString('hex'); tokenHash = referralHash(token);
      await Referral.updateOne({ _id: referral._id, emailState: 'sending' }, { $set: { tokenHash } });
      const result = await emailSender(buildOriginalReferralEmail({ referral, project, token }));
      if (result?.ok !== true) throw new Error(result?.error || 'Email was not accepted');
      await Referral.updateOne({ _id: referral._id, tokenHash }, { $set: { emailState: 'sent', leaseExpiresAt: null, lastError: '' } });
    } catch (error) {
      await Referral.updateOne({ _id: referral._id, ...(tokenHash ? { tokenHash } : {}) }, { $set: { emailState: referral.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: new Date(now.getTime() + 5 * 60 * 1000), lastError: String(error.message).slice(0,500) } });
    }
  }
}
