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
import { escapeEmailHtml } from '../utils/tscEmailBranding.js';
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
  const text = `Hi ${referral.fullName},\n\n${referral.referrerName} saw the TSC Originals project “${project.title}”, which is looking for ${referral.roleName}, and thought you might be a great fit.\n\nRead the brief and decide whether you would like to take part:\n${url}\n\nSign in or create an account using this email address. Your invitation gives access to this project only; it does not reserve a slot or guarantee selection.\n\nThe Supreme Collective`;
  return { to: referral.email, subject: `${referral.referrerName} recommended you for ${referral.roleName}`, text, html: `<p>Hi ${escapeEmailHtml(referral.fullName)},</p><p>${escapeEmailHtml(referral.referrerName)} saw <strong>${escapeEmailHtml(project.title)}</strong>, which is looking for <strong>${escapeEmailHtml(referral.roleName)}</strong>, and thought you might be a great fit.</p><p><a href="${escapeEmailHtml(url)}">Read the brief and consider taking part</a></p><p>Sign in or create an account using this email address. Access is for this project only; a recommendation does not reserve a slot or guarantee selection.</p><p>The Supreme Collective</p>` };
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
