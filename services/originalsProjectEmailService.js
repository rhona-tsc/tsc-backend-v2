import crypto from 'node:crypto';
import ProjectEmail from '../models/originalProjectEmailModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Submission from '../models/originalSubmissionModel.js';
import sendEmail from '../utils/sendEmail.js';
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';
import { isOriginalsEnabled } from './originalsPolicyService.js';
import { buildOriginalProjectApprovedEmail, collectOriginalsNotificationRecipients, PREVIEW_EMAIL_PATTERN } from './originalsNotificationService.js';
import { buildOriginalSubmissionConfirmationEmail } from '../utils/originalsSubmissionConfirmationEmail.js';

export const buildOriginalProjectModerationEmail = project => {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/moderation#project-${encodeURIComponent(String(project._id))}`;
  const title = project.title || 'Untitled project';
  return buildOriginalsEmail({
    subject: `Originals project awaiting approval: ${title}`, heading: 'A project is awaiting your approval',
    paragraphs: [`An Originals project is awaiting your approval: ${title}`, `Owner: ${project.ownerName || 'Unknown'} (${project.ownerEmail || 'No email provided'})`, project.description || '', `Genres: ${(project.genres || []).join(', ')}`, `Roles: ${(project.requestedRoles || []).map(role => role.name).join(', ')}`].filter(Boolean),
    buttonUrl: url, buttonLabel: 'Review the project',
  });
};

async function insertEmail(repository, record) {
  // Retried requests and worker reconciliation must not requeue delivered mail.
  try { await repository.updateOne({ eventKey: record.eventKey }, { $setOnInsert: record }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
}

export async function queueOriginalProjectModerationEmail({ project, emailRepository = ProjectEmail }) {
  const submittedAt = new Date(project.moderation.submittedAt);
  await insertEmail(emailRepository, {
    projectId: project._id, kind: 'moderation', submittedAt,
    eventKey: `moderation:${project._id}:${submittedAt.toISOString()}`,
    to: 'hello@thesupremecollective.co.uk', ...buildOriginalProjectModerationEmail(project),
  });
  return { queued: 1 };
}

export async function queueOriginalProjectLaunchEmails({ project, emailRepository = ProjectEmail, musicianRepository = Musician }) {
  // Use the same private-preview audience as the existing announcement button.
  const records = await musicianRepository.find({ email: { $regex: PREVIEW_EMAIL_PATTERN } }).select('email firstName').lean();
  const recipients = collectOriginalsNotificationRecipients(records);
  for (const recipient of recipients) {
    const { subject, text, html } = buildOriginalProjectApprovedEmail({ project, firstName: recipient.firstName });
    await insertEmail(emailRepository, { projectId: project._id, kind: 'launch', eventKey: `launch:${project._id}:${recipient.email}`, to: recipient.email, subject, text, html });
  }
  return { queued: recipients.length };
}

export const buildOriginalSubmissionEmail = ({ project, submission }) => {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/${encodeURIComponent(String(project._id))}#project-review`;
  const revision = Number(submission.revision || 1);
  const type = submission.category === 'mix' ? 'mix output' : submission.category === 'master' ? 'master output' : 'recording submission';
  const role = submission.roleName || 'Project role';
  const credit = submission.anonymous ? submission.creditName || 'An anonymous contributor' : 'A project contributor';
  return buildOriginalsEmail({
    subject: `${revision > 1 ? 'Updated' : 'New'} ${role} submission to review: ${project.title}`,
    heading: revision > 1 ? 'An updated submission is ready to review' : 'A new submission is ready to review',
    paragraphs: [`${credit} has ${revision > 1 ? 'updated' : 'made'} a ${type} for ${role} on “${project.title}”.`, `Revision ${revision}. Listen to the submitted recordings and record your decision in the workspace.`],
    buttonUrl: url, buttonLabel: 'Review the submission',
  });
};

export async function queueOriginalSubmissionEmail({ submission, emailRepository = ProjectEmail, projectRepository = Project, musicianRepository = Musician, now = new Date() }) {
  const project = await projectRepository.findById(submission.projectId).lean();
  if (!project || submission.state !== 'submitted' || ['cancelled', 'archived'].includes(project.state)) return;
  const owner = await musicianRepository.findById(project.ownerId).select('email').lean();
  const to = String(owner?.email || project.ownerEmail || '').trim().toLowerCase();
  if (!to) throw new Error('Project owner has no email address');
  await insertEmail(emailRepository, {
    projectId: project._id, kind: 'submission', submissionId: submission._id, revision: submission.revision || 1, ownerId: project.ownerId,
    eventKey: `submission:${submission._id}:${submission.revision || 1}`, sendAfter: now, to, ...buildOriginalSubmissionEmail({ project, submission }),
  });
}

export async function queueOriginalSubmissionConfirmation({ submission, emailRepository = ProjectEmail, projectRepository = Project, musicianRepository = Musician, now = new Date() }) {
  const project = await projectRepository.findById(submission.projectId).lean();
  if (!project || ['withdrawn', 'retracted'].includes(submission.state)) return;
  const musician = await musicianRepository.findById(submission.musicianId).select('email firstName').lean();
  if (!musician) return;
  const to = String(musician.email || '').trim().toLowerCase();
  if (!to) throw new Error('Submitting musician has no email address');
  await insertEmail(emailRepository, {
    projectId: project._id, kind: 'submission_confirmation', submissionId: submission._id,
    revision: submission.revision || 1, musicianId: submission.musicianId,
    eventKey: `submission-confirmation:${submission._id}:${submission.revision || 1}`, sendAfter: now, to,
    ...buildOriginalSubmissionConfirmationEmail({ project, submission, firstName: musician.firstName || 'there' }),
  });
}

export async function deliverOriginalProjectEmails({ emailSender = sendEmail, emailRepository = ProjectEmail, projectRepository = Project, musicianRepository = Musician, submissionRepository = Submission, now = new Date(), limit = 25 } = {}) {
  if (!isOriginalsEnabled()) return;
  // Repairs a submit/save succeeded but queue-write failed interruption. Historical
  // pending projects also get one review alert; resolved projects are excluded.
  const pending = await projectRepository.find({ state: 'pending_moderation', 'moderation.status': 'pending', 'moderation.submittedAt': { $ne: null } }).lean();
  for (const project of pending) await queueOriginalProjectModerationEmail({ project, emailRepository });
  const launches = await projectRepository.find({ 'moderation.status': 'approved', 'moderation.launchEmailPending': true }).lean();
  for (const project of launches) {
    await queueOriginalProjectLaunchEmails({ project, emailRepository, musicianRepository });
    await projectRepository.updateOne({ _id: project._id }, { $set: { 'moderation.launchEmailPending': false } });
  }
  // The marker is saved with the recording, so a queue outage or interrupted
  // request cannot lose an owner alert. Historical submissions are not backfilled.
  const submissions = await submissionRepository.find({ ownerNotificationPending: true }).limit(limit).lean();
  for (const submission of submissions) {
    try {
      await queueOriginalSubmissionEmail({ submission, emailRepository, projectRepository, musicianRepository, now });
      await submissionRepository.updateOne({ _id: submission._id, revision: submission.revision || 1 }, { $set: { ownerNotificationPending: false } });
    } catch (error) { console.error('Originals submission email queue will retry:', submission._id, error.message); }
  }
  // Save this marker atomically with each new submission/replacement. A failed
  // owner alert must not block the musician's receipt, and legacy takes stay quiet.
  const confirmations = await submissionRepository.find({ submitterConfirmationPending: true }).limit(limit).lean();
  for (const submission of confirmations) {
    if (submission.submitterConfirmationPending !== true) continue;
    try {
      await queueOriginalSubmissionConfirmation({ submission, emailRepository, projectRepository, musicianRepository, now });
      await submissionRepository.updateOne({ _id: submission._id, revision: submission.revision || 1 }, { $set: { submitterConfirmationPending: false } });
    } catch (error) { console.error('Originals submission confirmation queue will retry:', submission._id, error.message); }
  }
  for (let index = 0; index < limit; index++) {
    const leaseToken = crypto.randomUUID();
    const job = await emailRepository.findOneAndUpdate({ $or: [{ state: 'queued', sendAfter: { $lte: now } }, { state: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { state: 'sending', leaseToken, leaseExpiresAt: new Date(now.getTime() + 300000) }, $inc: { attempts: 1 } }, { new: true }).lean();
    if (!job) break;
    const filter = { _id: job._id, state: 'sending', leaseToken };
    try {
      const project = await projectRepository.findById(job.projectId).lean();
      let eligible = project && (job.kind === 'moderation'
        ? project.state === 'pending_moderation' && project.moderation?.status === 'pending' && new Date(project.moderation.submittedAt).getTime() === new Date(job.submittedAt).getTime()
        : project.moderation?.status === 'approved' && !['cancelled', 'archived', 'paused'].includes(project.state));
      let to = job.to;
      if (job.kind === 'submission') {
        const submission = await submissionRepository.findById(job.submissionId).lean();
        eligible = project && submission && String(project._id) === String(submission.projectId) && String(project.ownerId) === String(job.ownerId)
          && !['cancelled', 'archived'].includes(project.state) && submission.state === 'submitted' && submission.revisionSession?.status !== 'editing' && Number(submission.revision || 1) === job.revision;
        if (eligible) {
          const owner = await musicianRepository.findById(project.ownerId).select('email').lean();
          to = String(owner?.email || project.ownerEmail || '').trim().toLowerCase();
          if (!to) throw new Error('Project owner has no email address');
        }
      }
      if (job.kind === 'submission_confirmation') {
        const submission = await submissionRepository.findById(job.submissionId).lean();
        // A fast review or round advance does not invalidate a receipt. A changed
        // revision/recipient or withdrawn recording does invalidate a queued one.
        eligible = project && submission && String(project._id) === String(submission.projectId)
          && String(submission.musicianId) === String(job.musicianId) && Number(submission.revision || 1) === job.revision
          && !['withdrawn', 'retracted'].includes(submission.state);
        if (eligible) {
          const musician = await musicianRepository.findById(job.musicianId).select('email').lean();
          if (!musician) eligible = false;
          else {
            to = String(musician.email || '').trim().toLowerCase();
            if (!to) throw new Error('Submitting musician has no email address');
          }
        }
      }
      if (job.kind === 'revision') {
        const submission = await submissionRepository.findById(job.submissionId).lean();
        eligible = project && submission && submission.state === 'submitted' && String(project.currentRoundId) === String(submission.roundId) && !['cancelled', 'archived', 'paused'].includes(project.state);
        if (eligible) {
          const request = submission.revisionRequest, recording = submission.revisionSession;
          eligible = ['requested', 'escalated'].includes(job.revisionAction) ? request?.id === job.revisionEventId && request.status === 'pending'
            : job.revisionAction === 'declined' ? request?.id === job.revisionEventId && request.status === 'declined'
              : recording?.id === job.revisionEventId && recording.status === (job.revisionAction === 'expired' ? 'expired' : 'editing') && (job.revisionAction === 'expired' || new Date(recording.expiresAt) > now);
          if (eligible && job.revisionAction !== 'escalated') {
            const recipientId = job.revisionAction === 'requested' ? project.ownerId : submission.musicianId;
            const recipient = await musicianRepository.findById(recipientId).select('email').lean();
            to = String(recipient?.email || (job.revisionAction === 'requested' ? project.ownerEmail : '') || '').trim().toLowerCase();
            if (!to) throw new Error('Revision recipient has no email address');
          }
        }
      }
      if (!eligible) { await emailRepository.updateOne(filter, { $set: { state: 'cancelled', leaseExpiresAt: null } }); continue; }
      const result = await emailSender({ to, subject: job.subject, text: job.text, html: job.html });
      if (!result?.ok) throw new Error(result?.error || 'Email was not accepted');
      await emailRepository.updateOne(filter, { $set: { state: 'sent', leaseExpiresAt: null, lastError: '' } });
    } catch (error) {
      if (job.attempts >= 5) console.error('Originals project email exhausted delivery retries:', job._id, error.message);
      await emailRepository.updateOne(filter, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: new Date(now.getTime() + 300000), lastError: String(error.message).slice(0, 500) } });
    }
  }
}
