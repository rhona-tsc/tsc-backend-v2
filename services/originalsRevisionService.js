import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Musician from '../models/musicianModel.js';
import Email from '../models/originalProjectEmailModel.js';
import Event from '../models/originalEventModel.js';
import { canManageOriginalProject, canModerateOriginals, getOriginalsUserId } from './originalsPolicyService.js';
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';

const HOUR = 3600000;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
export const originalRevisionEditing = (submission, now = new Date()) => submission?.revisionSession?.status === 'editing' && new Date(submission.revisionSession.expiresAt) > now;

export function buildOriginalRevisionEmail({ project, submission, action, note = '', deadline }) {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/${encodeURIComponent(String(project._id))}#${['requested', 'escalated'].includes(action) ? 'project-review' : 'submit-take'}`;
  const descriptions = {
    requested: 'The contributor has requested permission to revise their submitted recording. Please approve or decline within seven days. If unanswered, TSC will be notified to review the request.',
    opened: 'Your recording session has reopened for a revision. Upload or choose your corrected recordings and submit them for review before the deadline below. Your previous submitted version is retained.',
    declined: 'Your request to revise the recording was declined. Your existing submission remains available for review.',
    expired: 'Your revision window has ended. Your last submitted version remains available for review. You can request permission to revise again in the workspace.',
    escalated: 'A request to revise a recording has been unanswered for seven days. TSC can now approve or decline it in the project workspace. No approval has been given automatically.',
  };
  const title = `${submission.roleName} — ${project.title}`;
  const lines = [descriptions[action], ...(deadline ? [`Deadline: ${new Date(deadline).toUTCString()}`] : []), ...(note ? [`Feedback / message: ${note}`] : [])];
  const heading = action === 'escalated' ? 'TSC review needed' : action === 'requested' ? 'Revision request' : action === 'opened' ? 'Revision session reopened' : action === 'declined' ? 'Revision request declined' : 'Revision window ended';
  return buildOriginalsEmail({ subject: `${heading}: ${title}`, heading, paragraphs: [title, ...lines], buttonUrl: url });
}

async function queueEmail({ project, submission, action, id, note, deadline, now, session }) {
  const recipient = action === 'escalated' ? null : await Musician.findById(action === 'requested' ? project.ownerId : submission.musicianId).select('email').session(session).lean();
  const to = action === 'escalated' ? 'hello@thesupremecollective.co.uk' : String(recipient?.email || (action === 'requested' ? project.ownerEmail : '') || '').trim().toLowerCase();
  if (!to) throw fail('The recipient needs an email address before this revision can be arranged');
  await Email.create([{ projectId: project._id, submissionId: submission._id, kind: 'revision', revisionEventId: id, revisionAction: action,
    musicianId: action === 'requested' ? project.ownerId : submission.musicianId,
    eventKey: `revision:${submission._id}:${id}:${action}`, to, state: 'queued', sendAfter: now,
    ...buildOriginalRevisionEmail({ project, submission, action, note, deadline }),
  }], { session });
}

export async function manageOriginalRevision({ submissionId, action, user, note = '', requestId, now = new Date() }) {
  if (!['open', 'request', 'owner_request', 'approve', 'decline'].includes(action)) throw fail('Choose a valid revision action', 400);
  note = String(note || '').trim();
  if (note.length > 2000) throw fail('Keep feedback or the revision request within 2,000 characters', 400);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const submission = await Submission.findById(submissionId).session(session);
      if (!submission) throw fail('Submission not found', 404);
      const project = await Project.findById(submission.projectId).session(session);
      const round = await Round.findById(submission.roundId).session(session);
      const reservation = await Reservation.findById(submission.reservationId).session(session);
      const actorId = getOriginalsUserId(user);
      const contributor = String(submission.musicianId) === actorId;
      const manager = project && canManageOriginalProject(project, user);
      if (['open', 'request'].includes(action) ? !contributor : !manager) throw fail('You cannot change this recording session', 403);
      if (!project || !round || !reservation || submission.state !== 'submitted' || String(project.currentRoundId) !== String(round._id) || !['open', 'reopened', 'review'].includes(round.state) || round.closeReason === 'next_round_opened' || ['cancelled', 'archived', 'paused', 'approved_master'].includes(project.state) || !['submitted', 'active'].includes(reservation.state) || reservation.slotHeld === false) throw fail('Only a pending submission in the current round can be revised');
      if (String(reservation.musicianId) !== String(submission.musicianId) || String(reservation.projectId) !== String(project._id) || String(reservation.roundId) !== String(round._id)) throw fail('The recording reservation does not match this submission');
      const request = submission.revisionRequest;
      if (['approve', 'decline'].includes(action)) {
        if (request?.status !== 'pending' || !requestId || request.id !== requestId) throw fail('This revision request has changed; refresh before responding');
        if (String(project.ownerId) !== actorId && (!canModerateOriginals(user) || new Date(request.responseDueAt) > now)) throw fail('TSC can decide this request after the owner’s seven-day response window', 403);
      }
      if (originalRevisionEditing(submission, now)) throw fail('A revision session is already open');
      if (['open', 'request', 'owner_request'].includes(action) && request?.status === 'pending') throw fail('A revision request is already awaiting a decision');
      let emailAction, eventId, deadline;
      if (action === 'request') {
        if (new Date(reservation.expiresAt) > now) throw fail('Your recording window is still open; reopen the session to make your correction');
        if (!note) throw fail('Add a short message explaining what you would like to revise', 400);
        submission.revisionRequest = { id: randomUUID(), status: 'pending', reason: note, requestedAt: now, responseDueAt: new Date(now.getTime() + 7 * 24 * HOUR) };
        emailAction = 'requested'; eventId = submission.revisionRequest.id; deadline = submission.revisionRequest.responseDueAt;
      } else if (action === 'decline') {
        submission.revisionRequest = { ...(request.toObject?.() || request), status: 'declined', feedback: note, decidedAt: now, decidedBy: actorId };
        emailAction = 'declined'; eventId = request.id;
      } else {
        if (action === 'open' && new Date(reservation.expiresAt) <= now) throw fail('Your recording window has ended; request permission to revise');
        deadline = action === 'open' ? new Date(reservation.expiresAt) : new Date(now.getTime() + 24 * HOUR);
        submission.revisionSession = { id: randomUUID(), status: 'editing', openedAt: now, expiresAt: deadline, openedBy: actorId, feedback: note, source: action === 'open' ? 'contributor' : action === 'approve' ? 'approved_request' : 'owner_request' };
        if (action === 'approve') submission.revisionRequest = { ...(request.toObject?.() || request), status: 'approved', feedback: note, decidedAt: now, decidedBy: actorId };
        submission.ownerNotificationPending = false;
        reservation.expiresAt = deadline;
        // Keep the submitted seat occupied while corrections are being prepared.
        reservation.state = 'submitted'; reservation.remindersSent = { twelveHour: false, sixHour: false, oneHour: false };
        await reservation.save({ session });
        emailAction = 'opened'; eventId = submission.revisionSession.id;
      }
      await Round.updateOne({ _id: round._id }, { $inc: { submissionSerial: 1 } }, { session });
      await submission.save({ session });
      await queueEmail({ project, submission, action: emailAction, id: eventId, note, deadline, now, session });
      await Event.create([{ projectId: project._id, roundId: round._id, type: `revision_${action}`, actorId, metadata: { submissionId: String(submissionId), requestId: requestId || eventId, note, deadline } }], { session });
      result = submission;
    });
    return result;
  } finally { await session.endSession(); }
}

export async function processOriginalRevisionTimers({ now = new Date() } = {}) {
  const candidates = await Submission.find({ state: 'submitted', $or: [{ 'revisionRequest.status': 'pending', 'revisionRequest.responseDueAt': { $lte: now }, 'revisionRequest.escalatedAt': { $exists: false } }, { 'revisionSession.status': 'editing', 'revisionSession.expiresAt': { $lte: now } }] }).lean();
  for (const candidate of candidates) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const submission = await Submission.findById(candidate._id).session(session);
        const project = submission && await Project.findById(submission.projectId).session(session);
        if (!submission || submission.state !== 'submitted' || !project || String(project.currentRoundId) !== String(submission.roundId) || ['cancelled', 'archived', 'paused', 'approved_master'].includes(project.state)) return;
        if (submission.revisionSession?.status === 'editing' && new Date(submission.revisionSession.expiresAt) <= now) {
          submission.revisionSession.status = 'expired';
          await queueEmail({ project, submission, action: 'expired', id: submission.revisionSession.id, now, session });
        }
        if (submission.revisionRequest?.status === 'pending' && new Date(submission.revisionRequest.responseDueAt) <= now && !submission.revisionRequest.escalatedAt) {
          submission.revisionRequest.escalatedAt = now;
          await queueEmail({ project, submission, action: 'escalated', id: submission.revisionRequest.id, note: submission.revisionRequest.reason, now, session });
          await Event.create([{ projectId: project._id, roundId: submission.roundId, type: 'revision_request_escalated', metadata: { submissionId: String(submission._id), requestId: submission.revisionRequest.id } }], { session });
        }
        await submission.save({ session });
      });
    } catch (error) { console.error('Originals revision timer will retry:', candidate._id, error.message); }
    finally { await session.endSession(); }
  }
}
