import { getOriginalAgreement, originalAgreementType, requireCurrentOriginalAgreement } from './originalsAgreementService.js';
import { eligibleRoundRoles, roleKey } from './originalsReservationService.js';
import { isOriginalRoundExpired } from './originalsPolicyService.js';
import crypto from 'node:crypto';
import Future from '../models/originalRoleReservationModel.js';
import Reservation from '../models/originalReservationModel.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Musician from '../models/musicianModel.js';
import Notification from '../models/originalNotificationModel.js';
import { activateOriginalRoleReservations } from './originalsReservationService.js';
import { loadOriginalMembership, originalParticipation } from './originalsMembershipService.js';
import { isOriginalsEnabled } from './originalsPolicyService.js';
import sendEmail from '../utils/sendEmail.js';
import { escapeEmailHtml } from '../utils/tscEmailBranding.js';

export const buildOriginalRoundOpenEmail = ({ project, reservation, firstName = 'there' }) => {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/,'')}/originals/${project._id}`;
  const deadline = new Date(reservation.expiresAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  return {
    subject: `${reservation.roleName} round is open — your place is reserved`,
    text: `Hi ${firstName},\n\nThe ${reservation.roleName} round for “${project.title}” is now open. Your advance place is now a 24-hour recording reservation, ending ${deadline} (UK time).\n\nRead the latest guidance, upload one to four stems, then submit your contribution. A separate listening mix is optional. Listen to each new stem in the workspace with the available project tracks and confirm that it lines up before submitting:\n${url}\n\nIf you cannot take part, release your reservation in the workspace so someone else can use the place.\n\nThe Supreme Collective`,
    html: `<p>Hi ${escapeEmailHtml(firstName)},</p><p>The <strong>${escapeEmailHtml(reservation.roleName)}</strong> round for <strong>${escapeEmailHtml(project.title)}</strong> is now open. Your place is reserved until <strong>${escapeEmailHtml(deadline)} (UK time)</strong>.</p><p>Upload one to four stems. A separate listening mix is optional. Listen to each new stem in the workspace with the available project tracks and confirm that it lines up before submitting.</p><p><a href="${escapeEmailHtml(url)}">Open the project and submit your recordings</a></p><p>If you cannot take part, release your reservation in the workspace so someone else can use the place.</p>`,
  };
};

export const buildOriginalAgreementReviewEmail = ({ project, reservation, firstName = 'there' }) => {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/,'')}/originals/${project._id}#project-roles`;
  return {
    subject: `${reservation.roleName} round is open — review your reservation agreement`,
    text: `Hi ${firstName},\n\nThe ${reservation.roleName} round for “${project.title}” is open. Please review and accept the current reservation agreement in the project workspace before your advance place can become a recording reservation. Your 24-hour recording countdown has not started.\n\n${url}\n\nIf you cannot take part, release your advance place in the workspace.\n\nThe Supreme Collective`,
    html: `<p>Hi ${escapeEmailHtml(firstName)},</p><p>The <strong>${escapeEmailHtml(reservation.roleName)}</strong> round for <strong>${escapeEmailHtml(project.title)}</strong> is open. Review and accept the current reservation agreement before your advance place can become a recording reservation. Your 24-hour recording countdown has not started.</p><p><a href="${escapeEmailHtml(url)}">Review your reservation agreement</a></p><p>If you cannot take part, release your advance place in the workspace.</p>`,
  };
};

export async function runOriginalRoundNotifications({ emailSender = sendEmail, now = new Date(), limit = 50 } = {}) {
  if (!isOriginalsEnabled()) return;
  const projectIds = (await Future.aggregate([{ $match: { $or: [{ state: 'waiting' }, { state: 'activated', activeReservationId: null }] } }, { $group: { _id: '$projectId' } }])).map(item => item._id);
  for (const projectId of projectIds) {
    const project = await Project.findById(projectId).lean();
    const round = project?.currentRoundId && await Round.findById(project.currentRoundId).lean();
    if (project && round) await activateOriginalRoleReservations({ project, round, now });
  }
  const pending = await Reservation.find({ futureReservationId: { $exists: true }, roundNotificationQueued: false }).limit(limit).lean();
  for (const reservation of pending) {
    if (reservation.state === 'active' && new Date(reservation.expiresAt) > now) {
      const eventKey = `reserved-round:${reservation._id}`;
      await Notification.updateOne({ recipientMusicianId: reservation.musicianId, eventKey }, { $setOnInsert: { projectId: reservation.projectId, recipientMusicianId: reservation.musicianId, eventKey, template: 'originals_reserved_round_open', channels: ['email'], payload: { reservationId: String(reservation._id) }, state: 'queued', sendAfter: now } }, { upsert: true });
    }
    await Reservation.updateOne({ _id: reservation._id }, { $set: { roundNotificationQueued: true } });
  }
  for (let i = 0; i < limit; i++) {
    const leaseToken = crypto.randomUUID();
    const job = await Notification.findOneAndUpdate({ template: { $in: ['originals_reserved_round_open', 'originals_reservation_agreement_review'] }, $or: [{ state: 'queued', sendAfter: { $lte: now } }, { state: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { state: 'sending', leaseToken, leaseExpiresAt: new Date(Date.now() + 300000) }, $inc: { attempts: 1 } }, { new: true }).lean();
    if (!job) break;
    const filter = { _id: job._id, state: 'sending', leaseToken };
    try {
      const review = job.template === 'originals_reservation_agreement_review';
      const reservation = review ? await Future.findById(job.payload.futureId).lean() : await Reservation.findById(job.payload.reservationId).lean();
      const project = await Project.findById(job.projectId).lean();
      const recipient = await Musician.findById(job.recipientMusicianId).select('email firstName').lean();
      let eligible = reservation && project && recipient?.email && String(reservation.projectId) === String(project._id) && String(reservation.musicianId) === String(job.recipientMusicianId) && !['cancelled','archived','paused','approved_master'].includes(project.state);
      if (eligible && review) {
        const round = await Round.findById(job.payload.roundId).lean();
        eligible = reservation.state === 'waiting' && String(project.currentRoundId) === String(job.payload.roundId) && round && ['open','reopened'].includes(round.state) && !isOriginalRoundExpired(round, now) && eligibleRoundRoles(round).some(role => roleKey(role) === roleKey(reservation.roleName)) && getOriginalAgreement(originalAgreementType(round)).textHash === job.payload.textHash;
        if (eligible) {
          try { await requireCurrentOriginalAgreement({ agreementAcceptanceId: reservation.agreementAcceptanceId, projectId: project._id, musicianId: reservation.musicianId, roleName: reservation.roleName, type: originalAgreementType(round) }); eligible = false; }
          catch (error) { if (error.code !== 'ORIGINALS_AGREEMENT_REQUIRED') throw error; }
        }
      } else if (eligible) eligible = reservation.state === 'active' && new Date(reservation.expiresAt) > now && String(project.currentRoundId) === String(reservation.roundId);
      const membership = eligible && originalParticipation(await loadOriginalMembership(project), reservation.musicianId, now);
      if (!eligible || !membership.notify || membership.blockedRoles.includes(roleKey(reservation.roleName))) {
        await Notification.updateOne(filter, { $set: { state: 'cancelled', leaseExpiresAt: null } }); continue;
      }
      const result = await emailSender({ to: recipient.email, ...(review ? buildOriginalAgreementReviewEmail : buildOriginalRoundOpenEmail)({ project, reservation, firstName: recipient.firstName }) });
      if (!result?.ok) throw new Error(result?.error || 'Email was not accepted');
      await Notification.updateOne(filter, { $set: { state: 'sent', leaseExpiresAt: null, lastError: '' } });
    } catch (error) {
      await Notification.updateOne(filter, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: new Date(now.getTime() + 300000), lastError: String(error.message).slice(0,500) } });
    }
  }
}
