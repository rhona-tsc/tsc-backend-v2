import crypto from 'node:crypto';
import Notification from '../models/originalNotificationModel.js';
import Reservation from '../models/originalReservationModel.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Musician from '../models/musicianModel.js';
import Submission from '../models/originalSubmissionModel.js';
import { isOriginalsEnabled, isOriginalRoundExpired } from './originalsPolicyService.js';
import { eligibleRoundRoles, roleKey } from './originalsReservationService.js';
import { loadOriginalMembership, originalParticipation } from './originalsMembershipService.js';
import sendEmail from '../utils/sendEmail.js';
import { escapeEmailHtml, buildTscEmailFooter } from '../utils/tscEmailBranding.js';

const monitorEmail = 'hello@thesupremecollective.co.uk';
const reminderHours = (expiresAt, now) => {
  const hours = (new Date(expiresAt) - now) / 3600000;
  return hours > 0 && hours <= 1 ? 1 : hours > 1 && hours <= 6 ? 6 : hours > 6 && hours <= 12 ? 12 : null;
};

export function buildOriginalReservationReminderEmail({ project, reservation, firstName = 'there', hours, round }) {
  const production = ['mix', 'master'].includes(round?.type);
  const section = production ? `Submit ${round.type} output` : 'Submit a take';
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/${project._id}${production ? '' : '#submit-take'}`;
  const deadline = new Date(reservation.expiresAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'long' });
  const deliverable = production ? `your ${round.type} output` : 'your stem or take';
  const subject = `Reminder: ${reservation.roleName} submission due within ${hours} hour${hours === 1 ? '' : 's'} — ${project.title}`;
  return {
    subject,
    text: `Hi ${firstName},\n\nYour ${reservation.roleName} reservation for “${project.title}” ends at ${deadline} (UK time). You have ${hours === 1 ? 'up to 1 hour' : `up to ${hours} hours`} left to submit ${deliverable}.\n\nUploading a file alone does not submit your contribution. Choose your files in ${section} and send them for review:\n${url}\n\nNeed longer? Request an extension in Reservations and extensions before your deadline. An extension request does not change the deadline unless approved. If you cannot take part, release your reservation in the workspace.\n\nThe Supreme Collective`,
    html: `<p>Hi ${escapeEmailHtml(firstName)},</p><p>Your <strong>${escapeEmailHtml(reservation.roleName)}</strong> reservation for <strong>${escapeEmailHtml(project.title)}</strong> ends at <strong>${escapeEmailHtml(deadline)} (UK time)</strong>. You have up to ${hours} hour${hours === 1 ? '' : 's'} left to submit ${deliverable}.</p><p>Uploading a file alone does not submit your contribution. Choose your files in ${section} and send them for review.</p><p><a href="${escapeEmailHtml(url)}">Open the project and submit</a></p><p>Need longer? Request an extension in Reservations and extensions before your deadline. The deadline changes only when an extension is approved. If you cannot take part, release your reservation in the workspace.</p>${buildTscEmailFooter({ audience: 'musician' })}`,
  };
}

export async function deliverOriginalReservationReminders({ emailSender = sendEmail, now = new Date(), limit = 50, env = process.env } = {}) {
  // Keep the existing workflow automation switch in charge of deadline emails.
  if (!isOriginalsEnabled(env) || String(env.ORIGINALS_AUTOMATION_ENABLED || '').toLowerCase() !== 'true') return;
  for (let index = 0; index < limit; index++) {
    const leaseToken = crypto.randomUUID();
    const job = await Notification.findOneAndUpdate({ template: 'originals_reservation_reminder', $or: [{ state: 'queued', sendAfter: { $lte: now } }, { state: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { state: 'sending', leaseToken, leaseExpiresAt: new Date(now.getTime() + 300000) }, $inc: { attempts: 1 } }, { new: true }).lean();
    if (!job) break;
    const filter = { _id: job._id, state: 'sending', leaseToken };
    try {
      const reservation = await Reservation.findById(job.payload?.reservationId).lean();
      const project = await Project.findById(job.projectId).lean();
      const round = reservation && await Round.findById(reservation.roundId).lean();
      const recipient = await Musician.findById(job.recipientMusicianId).select('email firstName').lean();
      const hours = Number(job.payload?.hours);
      let eligible = reservation && project && round && recipient?.email && reservation.state === 'active' && reservation.slotHeld !== false
        && String(reservation.projectId) === String(project._id) && String(round.projectId) === String(project._id)
        && String(reservation.musicianId) === String(job.recipientMusicianId) && String(project.currentRoundId) === String(round._id)
        && !['cancelled', 'archived', 'paused', 'approved_master'].includes(project.state)
        && ['open', 'reopened'].includes(round.state) && !isOriginalRoundExpired(round, now)
        && eligibleRoundRoles(round).some(role => roleKey(role) === roleKey(reservation.roleName))
        && reminderHours(reservation.expiresAt, now) === hours
        && (!job.payload.expiresAt || +new Date(job.payload.expiresAt) === +new Date(reservation.expiresAt));
      if (eligible) eligible = !await Submission.exists({ projectId: project._id, reservationId: reservation._id });
      if (eligible) {
        const membership = originalParticipation(await loadOriginalMembership(project), reservation.musicianId, now);
        eligible = membership.notify && !membership.blockedRoles.includes(roleKey(reservation.roleName));
      }
      if (!eligible) { await Notification.updateOne(filter, { $set: { state: 'cancelled', leaseExpiresAt: null } }); continue; }
      const bccEnabled = String(env.ORIGINALS_RESERVATION_REMINDER_BCC_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
      const bcc = bccEnabled && recipient.email.trim().toLowerCase() !== monitorEmail ? monitorEmail : undefined;
      const result = await emailSender({ to: recipient.email, ...(bcc ? { bcc } : {}), ...buildOriginalReservationReminderEmail({ project, reservation, firstName: recipient.firstName || 'there', hours, round }) });
      if (!result?.ok) throw new Error(result?.error || 'Email was not accepted');
      await Notification.updateOne(filter, { $set: { state: 'sent', leaseExpiresAt: null, lastError: '' } });
    } catch (error) {
      await Notification.updateOne(filter, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: new Date(now.getTime() + 300000), lastError: String(error.message).slice(0, 500) } });
    }
  }
}
