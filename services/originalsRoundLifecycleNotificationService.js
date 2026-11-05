import crypto from 'node:crypto';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Notification from '../models/originalNotificationModel.js';
import { isOriginalsEnabled, isOriginalRoundExpired } from './originalsPolicyService.js';
import { eligibleRoundRoles, roleKey } from './originalsReservationService.js';
import { loadOriginalMembership, originalParticipation } from './originalsMembershipService.js';
import sendEmail from '../utils/sendEmail.js';
import { escapeEmailHtml, buildTscEmailFooter, buildTscEmailFooterText } from '../utils/tscEmailBranding.js';

const invitationMonitorEmail = 'hello@thesupremecollective.co.uk';

export const buildOriginalRoundClosedEmail = ({ project, roleNames, firstName = 'there' }) => ({
  subject: `${roleNames.join(', ')} round closed: ${project.title}`,
  text: `Hi ${firstName},\n\nThe owner has selected a contribution and moved “${project.title}” to the next round. Your remaining ${roleNames.join(', ')} place is now closed, so please stop recording or uploading for that round. Any unselected recordings will not be used.\n\nAny accepted contribution or other role you still hold is unaffected. Project and chat access continue only where you still have an eligible role or accepted contribution.\n\nThank you for the time you put into the project.\nThe Supreme Collective`,
  html: `<p>Hi ${escapeEmailHtml(firstName)},</p><p>The owner has selected a contribution and moved <strong>${escapeEmailHtml(project.title)}</strong> to the next round. Your remaining <strong>${escapeEmailHtml(roleNames.join(', '))}</strong> place is now closed. Please stop recording or uploading for that round. Any unselected recordings will not be used.</p><p>Any accepted contribution or other role you still hold is unaffected. Project and chat access continue only where you still have an eligible role or accepted contribution.</p><p>Thank you for the time you put into the project.<br>The Supreme Collective</p>`,
});
export const buildOriginalPrivateInvitationEmail = ({ project, invitation, firstName = 'there' }) => {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/${encodeURIComponent(String(project._id))}#project-roles`;
  return {
    subject: `You are invited for ${invitation.roleName}: ${project.title}`,
    text: `Hi ${firstName},\n\nYou have been invited for ${invitation.roleName} on “${project.title}”. Open the workspace, read the guidance and accept the contributor agreement to reserve an available recording place. An invitation alone does not reserve a slot.${invitation.message ? `\n\nA message for you:\n${invitation.message}` : ''}\n\nOpen the project: ${url}\n\nWarmest wishes,\nThe Supreme Collective\n\n${buildTscEmailFooterText()}`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your project invitation</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;">
<tr><td style="padding:26px 24px;background:#111111;border-radius:20px 20px 0 0;">
<p style="margin:0 0 12px;font-size:12px;line-height:18px;letter-spacing:2px;font-weight:700;color:#ff8585;">TSC ORIGINALS</p>
<h1 style="margin:0;font-size:28px;line-height:35px;color:#ffffff;">You’re invited to join a project</h1></td></tr>
<tr><td style="padding:28px 24px;word-break:break-word;overflow-wrap:anywhere;">
<p style="margin:0 0 18px;font-size:16px;line-height:26px;">Hi ${escapeEmailHtml(firstName)},</p>
<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">You have been invited for <strong>${escapeEmailHtml(invitation.roleName)}</strong> on <strong>${escapeEmailHtml(project.title)}</strong>.</p>
<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">Read the guidance and accept the contributor agreement to reserve an available recording place. An invitation alone does not reserve a slot.</p>
${invitation.message ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:18px;word-break:break-word;overflow-wrap:anywhere;"><p style="margin:0 0 8px;font-size:12px;line-height:18px;font-weight:700;color:#666666;">A MESSAGE FOR YOU</p><p style="margin:0;font-size:16px;line-height:26px;color:#444444;">${escapeEmailHtml(invitation.message).replace(/\r?\n/g, '<br>')}</p></td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#ff6667" style="border-radius:8px;text-align:center;">
<a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:14px 24px;font-size:16px;line-height:24px;font-weight:700;color:#111111;text-decoration:none;">Open the project</a></td></tr></table>
<p style="margin:0;font-size:15px;line-height:25px;color:#444444;">Warmest wishes,<br><strong>The Supreme Collective</strong></p>
${buildTscEmailFooter({ audience: 'musician' })}
</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`,
  };
};
async function queue(record, now) {
  try { await Notification.updateOne({ recipientMusicianId: record.recipientMusicianId, eventKey: record.eventKey }, { $setOnInsert: { ...record, channels: ['email'], state: 'queued', sendAfter: now } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
}

export async function deliverOriginalRoundLifecycleNotifications({ emailSender = sendEmail, now = new Date(), limit = 50, env = process.env } = {}) {
  if (!isOriginalsEnabled(env)) return;
  const closed = await Round.find({ closureNotificationsPending: true }).limit(limit).lean();
  for (const round of closed) {
    if (round.state === 'closed' && round.closeReason === 'next_round_opened') {
      const reservations = await Reservation.find({ roundId: round._id, endedByRoundAdvance: true, roundAdvanceClosedAt: round.closedAt }).lean();
      const recipients = new Map();
      for (const reservation of reservations) {
        const id = String(reservation.musicianId);
        recipients.set(id, [...new Set([...(recipients.get(id) || []), reservation.roleName])]);
      }
      for (const [id, roleNames] of recipients) await queue({ projectId: round.projectId, recipientMusicianId: id,
        eventKey: `round-closed:${round._id}:${new Date(round.closedAt).toISOString()}`, template: 'originals_round_closed', payload: { roundId: String(round._id), closedAt: new Date(round.closedAt).toISOString(), roleNames } }, now);
    }
    await Round.updateOne({ _id: round._id, closedAt: round.closedAt }, { $set: { closureNotificationsPending: false } });
  }
  const invitations = await Invitation.find({ emailPending: true }).limit(limit).lean();
  for (const invitation of invitations) {
    await queue({ projectId: invitation.projectId, recipientMusicianId: invitation.invitedMusicianId,
      eventKey: `invitation:${invitation._id}:created`, template: 'originals_private_invitation', payload: { invitationId: String(invitation._id), roundId: String(invitation.roundId) } }, now);
    await Invitation.updateOne({ _id: invitation._id }, { $set: { emailPending: false } });
  }
  for (let index = 0; index < limit; index++) {
    const leaseToken = crypto.randomUUID();
    const job = await Notification.findOneAndUpdate({ template: { $in: ['originals_round_closed', 'originals_private_invitation'] }, $or: [{ state: 'queued', sendAfter: { $lte: now } }, { state: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { state: 'sending', leaseToken, leaseExpiresAt: new Date(now.getTime() + 300000) }, $inc: { attempts: 1 } }, { new: true }).lean();
    if (!job) break;
    const filter = { _id: job._id, state: 'sending', leaseToken };
    try {
      const project = await Project.findById(job.projectId).lean();
      const recipient = await Musician.findById(job.recipientMusicianId).select('email firstName').lean();
      let round = job.payload.roundId ? await Round.findById(job.payload.roundId).lean() : null;
      let eligible = project && recipient?.email && !['cancelled', 'archived'].includes(project.state);
      let message;
      if (job.template === 'originals_round_closed') {
        eligible = eligible && round && round.state === 'closed' && round.closeReason === 'next_round_opened' && new Date(round.closedAt).toISOString() === job.payload.closedAt && String(project.currentRoundId) !== String(round._id)
          && await Reservation.exists({ roundId: round._id, musicianId: job.recipientMusicianId, endedByRoundAdvance: true, roundAdvanceClosedAt: round.closedAt });
        if (eligible) message = buildOriginalRoundClosedEmail({ project, roleNames: job.payload.roleNames, firstName: recipient.firstName });
      } else {
        const invitation = await Invitation.findById(job.payload.invitationId).lean();
        // Older queued invitation records did not include roundId in their payload.
        if (invitation && !round) round = await Round.findById(invitation.roundId).lean();
        eligible = eligible && invitation && String(invitation.projectId) === String(project._id) && String(invitation.invitedMusicianId) === String(job.recipientMusicianId)
          && ['pending', 'accepted'].includes(invitation.state) && round && String(project.currentRoundId) === String(round._id) && ['open', 'reopened'].includes(round.state)
          && (!invitation.expiresAt || new Date(invitation.expiresAt) > now) && !isOriginalRoundExpired(round, now)
          && eligibleRoundRoles(round).some(role => roleKey(role) === roleKey(invitation.roleName));
        if (eligible) eligible = originalParticipation(await loadOriginalMembership(project), job.recipientMusicianId, now).canAccess;
        if (eligible) message = buildOriginalPrivateInvitationEmail({ project, invitation, firstName: recipient.firstName });
      }
      if (!eligible) { await Notification.updateOne(filter, { $set: { state: 'cancelled', leaseExpiresAt: null } }); continue; }
      const bccEnabled = job.template === 'originals_private_invitation' && String(env.ORIGINALS_INVITATION_BCC_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
      const bcc = bccEnabled && recipient.email.trim().toLowerCase() !== invitationMonitorEmail ? invitationMonitorEmail : undefined;
      const result = await emailSender({ to: recipient.email, ...(bcc ? { bcc } : {}), ...message });
      if (!result?.ok) throw new Error(result?.error || 'Email was not accepted');
      await Notification.updateOne(filter, { $set: { state: 'sent', leaseExpiresAt: null, lastError: '' } });
    } catch (error) {
      await Notification.updateOne(filter, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: new Date(now.getTime() + 300000), lastError: String(error.message).slice(0, 500) } });
    }
  }
}
