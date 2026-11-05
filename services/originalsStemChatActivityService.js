import Message from '../models/originalMessageModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import { chatDisplayName } from './originalsChatService.js';
import { isOriginalsEnabled } from './originalsPolicyService.js';

// The chat's existing unique project/author/client-message index deduplicates
// activity. Clients cannot use this reserved namespace. Keep native ObjectIds
// so equal-time message cursors retain their normal insertion order.
export const originalStemActivityKey = (submissionId, type) => `system:${submissionId}:${type}`;

export function originalStemActivityBody({ submission, project, profile, type }) {
  const isOwner = String(submission.musicianId) === String(project.ownerId);
  const anonymous = submission.anonymous || (isOwner && project.ownerAnonymous);
  const name = anonymous
    ? String(submission.creditName || (isOwner && project.ownerCreditName) || 'Anonymous').trim() || 'Anonymous'
    : chatDisplayName([profile?.firstName || profile?.basicInfo?.firstName, profile?.lastName || profile?.basicInfo?.lastName].filter(Boolean).join(' ') || (isOwner && project.ownerName) || 'Project participant');
  const stemCount = new Set((submission.takes || []).flatMap(take => take.stemAssetIds?.length ? take.stemAssetIds.map(String) : [String(take.stemAssetId)])).size;
  return type === 'stem_approved'
    ? `${submission.roleName} stem approved — ${name}’s contribution has been selected.`
    : `${name} submitted ${stemCount > 1 ? `${stemCount} stems` : 'a stem'} for ${submission.roleName}. Ready for owner review.`;
}

export const originalStemChatActivity = {
  async publish(submission) {
    if (submission.category && submission.category !== 'contribution') return;
    if (!submission.submittedChatPending && !submission.approvedChatPending) return;
    const project = await Project.findById(submission.projectId).lean();
    if (!project) return;
    const anonymous = submission.anonymous || (String(submission.musicianId) === String(project.ownerId) && project.ownerAnonymous);
    const profile = anonymous ? null : await Musician.findById(submission.musicianId)
      .select('firstName lastName basicInfo.firstName basicInfo.lastName').lean();
    for (const [pendingField, messageType, authorId] of [
      ['submittedChatPending', 'stem_submitted', submission.musicianId],
      ['approvedChatPending', 'stem_approved', submission.decidedBy || project.ownerId],
    ]) {
      if (!submission[pendingField]) continue;
      // Use posting time: a recovered update must remain unread even if someone
      // has already read newer conversation since the original submission.
      const createdAt = new Date();
      const filter = { projectId: submission.projectId, authorId, clientMessageId: originalStemActivityKey(submission._id, messageType) };
      const message = {
        projectId: submission.projectId, authorId, messageType,
        body: originalStemActivityBody({ submission, project, profile, type: messageType }),
        authorCreditName: 'Project update', authorAnonymous: false,
        attachmentIds: [], voiceAssetId: null, chatNotificationsQueued: false, createdAt,
      };
      try {
        await Message.updateOne(filter, { $setOnInsert: message }, { upsert: true });
      } catch (error) {
        // A concurrent insertion is successful only if this exact activity exists.
        if (error.code !== 11000 || !await Message.exists({ ...filter, messageType })) throw error;
      }
      // Clear the durable marker only after the message is saved. If this fails,
      // the next attempt reuses the same activity key and cannot post a duplicate.
      await Submission.updateOne({ _id: submission._id, [pendingField]: true }, { $set: { [pendingField]: false } });
    }
  },
  async reconcile({ limit = 50 } = {}) {
    if (!isOriginalsEnabled()) return;
    const pending = await Submission.find({ $or: [{ submittedChatPending: true }, { approvedChatPending: true }] })
      .sort({ submittedAt: 1 }).limit(limit).lean();
    for (const submission of pending) {
      try { await this.publish(submission); }
      catch (error) { console.error('Originals stem chat update will retry:', error.message); }
    }
  },
};
