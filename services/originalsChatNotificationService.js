import { claimedOriginalReferral } from "./originalsReferralService.js";
import { randomUUID } from "node:crypto";
import Message from "../models/originalMessageModel.js";
import Notification from '../models/originalNotificationModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import { loadOriginalMembership, originalChatRecipients, originalParticipation } from './originalsMembershipService.js';
import { canAccessOriginalsPreview, isOriginalsEnabled } from './originalsPolicyService.js';
import sendEmail from '../utils/sendEmail.js';
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';

export const buildOriginalChatEmail = ({ project, firstName = 'there' }) => {
  const title = project.title || 'Your Originals project';
  const projectUrl = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/${encodeURIComponent(String(project._id))}#project-chat`;
  return buildOriginalsEmail({
    subject: `New group chat message: ${title}`, heading: 'There’s a new message in your project chat', firstName,
    paragraphs: [`There is a new message in the ${title} project group chat.`],
    buttonUrl: projectUrl, buttonLabel: 'Read and reply in the chat', afterButton: ['Sign in to catch up and reply in the project workspace.'],
  });
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
