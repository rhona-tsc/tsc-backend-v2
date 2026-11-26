import crypto from 'node:crypto';
import ProjectEmail from '../models/originalProjectEmailModel.js';
import Preferences from '../models/musicianEmailPreferenceModel.js';
import { planOriginalsLaunchAudience } from './originalsLaunchAudienceService.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Asset from '../models/originalAssetModel.js';
import sendEmail from '../utils/sendEmail.js';
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';
import { isOriginalsEnabled } from './originalsPolicyService.js';
import { buildOriginalProjectApprovedEmail, collectOriginalsNotificationRecipients } from './originalsNotificationService.js';
import { buildOriginalSubmissionConfirmationEmail } from '../utils/originalsSubmissionConfirmationEmail.js';
import { createOriginalsEmailPlaybackToken, originalsEmailPlaybackUrls } from './originalsEmailPlaybackService.js';
import { loadOriginalMembership, originalParticipation } from './originalsMembershipService.js';

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
  try { return await repository.updateOne({ eventKey: record.eventKey }, { $setOnInsert: record }, { upsert: true }); }
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

export async function queueOriginalProjectLaunchEmails({ project, emailRepository = ProjectEmail, musicianRepository = Musician, preferenceRepository = Preferences, assetRepository = Asset }) {
  const [records, preferences, guide] = await Promise.all([
    musicianRepository.find({ profileDeletedAt: null, privateTestProfile: { $ne: true } })
      .select('_id email firstName role status profileDeletedAt privateTestProfile').lean(),
    preferenceRepository.find({}).lean(),
    assetRepository.findOne({ projectId: project._id, state: 'active', kind: 'guide_track', mimeType: /^audio\// }).sort({ createdAt: 1 }).lean(),
  ]);
  const recipients = collectOriginalsNotificationRecipients(records, preferences);
  let queued = 0;
  for (const recipient of recipients) {
    const playback = guide ? originalsEmailPlaybackUrls(createOriginalsEmailPlaybackToken({ projectId: project._id, assetId: guide._id, musicianId: recipient.musicianId })) : null;
    const { subject, text, html } = buildOriginalProjectApprovedEmail({ project, firstName: recipient.firstName, playback, guide });
    const result = await insertEmail(emailRepository, { projectId: project._id, kind: 'launch', musicianId: recipient.musicianId,
      eventKey: `launch:${project._id}:${recipient.email}`, to: recipient.email, subject, text, html });
    queued += result?.upsertedCount || 0;
  }
  return { queued, eligible: recipients.length };
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

export async function deliverOriginalProjectEmails({ emailSender = sendEmail, emailRepository = ProjectEmail, projectRepository = Project, musicianRepository = Musician, assetRepository = Asset, submissionRepository = Submission, now = new Date(), limit = 50, preferenceRepository = Preferences } = {}) {
  if (!isOriginalsEnabled()) return;
  // Repairs a submit/save succeeded but queue-write failed interruption. Historical
  // pending projects also get one review alert; resolved projects are excluded.
  const pending = await projectRepository.find({ state: 'pending_moderation', 'moderation.status': 'pending', 'moderation.submittedAt': { $ne: null } }).lean();
  for (const project of pending) await queueOriginalProjectModerationEmail({ project, emailRepository });
  const launches = await projectRepository.find({ 'moderation.status': 'approved', 'moderation.launchEmailPending': true }).lean();
  for (const project of launches) {
    await queueOriginalProjectLaunchEmails({ project, emailRepository, musicianRepository, preferenceRepository, assetRepository });
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
      if (job.kind === 'project_update' && eligible) {
        const recipient = await musicianRepository.findById(job.musicianId).select('email profileDeletedAt').lean();
        eligible = recipient && !recipient.profileDeletedAt && String(recipient.email || '').trim().toLowerCase() === job.to
          && originalParticipation(await loadOriginalMembership(project), job.musicianId, now).notify;
      }
      if (job.kind === 'launch' && eligible) {
        const recipient = job.musicianId
          ? await musicianRepository.findById(job.musicianId).select('_id email firstName role status profileDeletedAt privateTestProfile').lean()
          : await musicianRepository.findOne({ email: job.to }).select('_id email firstName role status profileDeletedAt privateTestProfile').lean();
        // Never redirect an old queued announcement to a changed email address.
        eligible = recipient && planOriginalsLaunchAudience([recipient]).recipients.some(item => item.email === job.to);
      }
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
      const result = await emailSender({ musicianPreferences: true, ...(job.kind === 'launch' ? { opportunityCategory: 'originals' } : {}), to, subject: job.subject, text: job.text, html: job.html });
      if (!result?.ok) throw new Error(result?.error || 'Email was not accepted');
      await emailRepository.updateOne(filter, { $set: { state: result.skipped ? 'cancelled' : 'sent', leaseExpiresAt: null, lastError: '', messageId: result.messageId || '', sentAt: result.skipped ? null : new Date() } });
    } catch (error) {
      const providerBackoff = job.kind === 'launch' && /too many login attempts|daily.{0,30}(?:limit|quota)|sending quota exceeded/i.test(String(error.message));
      const dailyQuota = /daily|sending quota/i.test(String(error.message));
      const retryAt = new Date(now.getTime() + (providerBackoff ? (dailyQuota ? 24 : 1) * 3600000 : 300000));
      if (job.attempts >= 5) console.error('Originals project email exhausted delivery retries:', job._id, error.message);
      await emailRepository.updateOne(filter, { $set: { state: !providerBackoff && job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: retryAt, lastError: String(error.message).slice(0, 500) } });
      if (providerBackoff) {
        // An account-level throttle is not a rejection of each musician. Stop
        // this batch and defer all launch mail rather than hammering logins.
        await emailRepository.updateMany({ kind: 'launch', state: 'queued', sendAfter: { $lt: retryAt } }, { $set: { sendAfter: retryAt } });
        return { deferredUntil: retryAt };
      }
    }
  }
}
