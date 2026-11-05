import { claimedOriginalReferral } from "./originalsReferralService.js";
import { randomUUID } from "node:crypto";
import Message from "../models/originalMessageModel.js";
import Notification from '../models/originalNotificationModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import { loadOriginalMembership, originalChatRecipients, originalParticipation } from './originalsMembershipService.js';
import { canAccessOriginalsPreview, isOriginalsEnabled } from './originalsPolicyService.js';
import sendEmail from '../utils/sendEmail.js';
import { escapeEmailHtml, buildTscEmailFooter, buildTscEmailFooterText } from '../utils/tscEmailBranding.js';

export const buildOriginalChatEmail = ({ project, firstName = 'there' }) => {
  const base = String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '');
  const projectUrl = `${base}/originals/${project._id}#project-chat`;
  const title = project.title || 'Your Originals project';
  return {
    subject: `New group chat message: ${title}`,
    text: `Hi ${firstName},\n\nThere is a new message in the ${title} project group chat.\n\nRead and reply: ${projectUrl}\n\nWarmest wishes,\nThe Supreme Collective\n\n${buildTscEmailFooterText()}`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New project chat message</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
    <!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;">
      <tr><td style="padding:26px 24px;background:#111111;border-radius:20px 20px 0 0;">
        <p style="margin:0 0 12px;font-size:12px;line-height:18px;letter-spacing:2px;font-weight:700;color:#ff8585;">TSC ORIGINALS</p>
        <h1 style="margin:0;font-size:28px;line-height:35px;color:#ffffff;">Your project chat has a new message</h1>
      </td></tr>
      <tr><td style="padding:28px 24px;">
        <p style="margin:0 0 18px;font-size:16px;line-height:26px;">Hi ${escapeEmailHtml(firstName)},</p>
        <p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">There’s a new message waiting in your project group chat.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:18px;word-break:break-word;overflow-wrap:anywhere;">
          <p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#666666;">PROJECT</p>
          <p style="margin:0;font-size:20px;line-height:28px;font-weight:700;color:#111111;">${escapeEmailHtml(title)}</p>
        </td></tr></table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#ff6667" style="border-radius:8px;text-align:center;">
          <a href="${escapeEmailHtml(projectUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;line-height:24px;font-weight:700;color:#111111;text-decoration:none;">Read and reply in the chat</a>
        </td></tr></table>
        <p style="margin:0 0 24px;font-size:13px;line-height:21px;color:#666666;">Sign in to catch up and reply in the project workspace.</p>
        <p style="margin:0;font-size:15px;line-height:25px;color:#444444;">Warmest wishes,<br><strong>The Supreme Collective</strong></p>
        ${buildTscEmailFooter({ audience: 'musician' })}
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`,
  };
};

export async function queueOriginalChatNotifications({ project, message }) {
  const recipients = originalChatRecipients(await loadOriginalMembership(project), message.authorId);
  if (recipients.length) await Notification.bulkWrite(recipients.map(recipientMusicianId => ({ updateOne: {
    filter: { recipientMusicianId, eventKey: `group-message:${message._id}:${recipientMusicianId}` },
    update: { $setOnInsert: { projectId: project._id, recipientMusicianId, eventKey: `group-message:${message._id}:${recipientMusicianId}`, channels: ['email'], template: 'originals_group_chat_message', payload: { messageId: String(message._id) }, state: 'queued', sendAfter: new Date(), attempts: 0 } },
    upsert: true,
  } })), { ordered: false });
  await Message.updateOne({ _id: message._id }, { $set: { chatNotificationsQueued: true } });
}

// Claims keep concurrent requests / scheduled workers from sending the same queued email.
export async function deliverOriginalChatNotifications({ projectId, emailSender = sendEmail, now = new Date(), limit = 50 } = {}) {
  const result = { sent: 0, cancelled: 0, failed: 0 };
  if (!isOriginalsEnabled() || String(process.env.ORIGINALS_CHAT_EMAIL_ENABLED || "true").toLowerCase() === "false") return result;
  // New messages carry an outbox marker: recover even when queue creation failed after saving.
  // Legacy messages have no marker and are deliberately excluded from this reconciliation.
  const pending = await Message.find({ chatNotificationsQueued: false, ...(projectId ? { projectId } : {}) }).sort({ createdAt: 1 }).limit(limit).lean();
  for (const message of pending) {
    try {
      const project = await Project.findById(message.projectId).lean();
      if (project) await queueOriginalChatNotifications({ project, message });
    } catch (error) { console.error('Originals chat notification queue will retry:', error); }
  }
  const base = { template: 'originals_group_chat_message', channels: 'email', ...(projectId ? { projectId } : {}) };
  for (let count = 0; count < limit; count++) {
    const leaseToken = randomUUID();
    const job = await Notification.findOneAndUpdate({ ...base, $or: [{ state: 'queued', sendAfter: { $lte: now } }, { state: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { state: 'sending', leaseToken, leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).lean();
    if (!job) break;
    try {
      const project = await Project.findById(job.projectId).lean();
      const recipient = await Musician.findById(job.recipientMusicianId).select('email firstName role').lean();
      // Recheck at delivery, not only at queue time: advancing a round revokes queued chat alerts too.
      const eligible = project && recipient?.email && (canAccessOriginalsPreview({ ...recipient, id: String(job.recipientMusicianId) }) || await claimedOriginalReferral(project._id, job.recipientMusicianId)) && originalParticipation(await loadOriginalMembership(project), job.recipientMusicianId, new Date()).notify;
      if (!eligible) {
        await Notification.updateOne({ _id: job._id, state: 'sending', leaseToken }, { $set: { state: 'cancelled', leaseExpiresAt: null } });
        result.cancelled++; continue;
      }
      const receipt = await emailSender({ to: recipient.email, ...buildOriginalChatEmail({ project, firstName: recipient.firstName || 'there' }) });
      if (receipt?.ok !== true) throw new Error(receipt?.error || receipt?.reason || 'Email was not accepted');
      await Notification.updateOne({ _id: job._id, state: 'sending', leaseToken }, { $set: { state: 'sent', leaseExpiresAt: null, lastError: '' } });
      result.sent++;
    } catch (error) {
      await Notification.updateOne({ _id: job._id, state: 'sending', leaseToken }, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, lastError: String(error.message || 'Delivery failed').slice(0, 500), sendAfter: new Date(now.getTime() + 5 * 60 * 1000) } });
      result.failed++;
    }
  }
  return result;
}
