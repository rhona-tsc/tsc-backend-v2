import Future from '../models/originalRoleReservationModel.js';
import { requireOriginalTemporaryReplacements } from './originalsTemporaryStemService.js';
import mongoose from 'mongoose';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Asset from '../models/originalAssetModel.js';
import Event from '../models/originalEventModel.js';
import { canManageOriginalProject, getOriginalsUserId } from './originalsPolicyService.js';
import { originalTakeAssetIds } from './originalsTakeFilesService.js';

const conflict = message => Object.assign(new Error(message), { status: 409 });
const key = value => String(value || '').trim().toLowerCase();

// The new round, old-round closure, affected submissions and reservations must
// commit together. Concurrent owners cannot open two successive empty stages.
export async function advanceOriginalRound({ projectId, fromRoundId, type, roleName, user, now = new Date() }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const project = await Project.findById(projectId).session(session);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      if (!canManageOriginalProject(project, user)) throw Object.assign(new Error('Only the project owner or TSC can open stages'), { status: 403 });
      if (String(project.currentRoundId) !== String(fromRoundId)) throw conflict('The project has already moved to another round. Refresh the workspace.');
      if (['cancelled', 'archived', 'paused', 'approved_master'].includes(project.state)) throw conflict('This project cannot open another round right now');
      const previous = await Round.findById(project.currentRoundId).session(session);
      if (!previous || !['open', 'reopened', 'review', 'closed'].includes(previous.state)) throw conflict('The current round is unavailable');
      const accepted = await Submission.find({ projectId: project._id, roundId: previous._id, state: 'accepted' }).session(session).lean();
      if (!accepted.length) throw conflict('Approve a submission in the current round before opening the next one');
      if (['mix', 'master'].includes(type)) await requireOriginalTemporaryReplacements({ projectId: project._id, session });
      let nextRole;
      if (type === 'instrument') {
        nextRole = project.requestedRoles.find(role => key(role.name) === key(roleName))?.name;
        if (!nextRole) throw conflict('Choose one of the project’s requested instruments');
        if (await Submission.exists({ projectId: project._id, category: 'contribution', state: 'accepted', roleName: nextRole }).session(session)) throw conflict('That instrument already has an approved contribution. Choose the next unfinished part.');
      } else {
        const category = type === 'master' ? 'mix' : 'contribution';
        if (!await Submission.exists({ projectId: project._id, category, state: 'accepted' }).session(session)) throw conflict(type === 'master' ? 'Accept a mix before opening mastering' : 'Accept a recording before opening mixing');
        nextRole = type === 'mix' ? 'Mix producer' : 'Mastering engineer';
      }
      const pending = await Submission.find({ projectId: project._id, roundId: previous._id, state: 'submitted' }).session(session).lean();
      if (pending.some(item => item.revisionRequest?.status === 'pending' || (item.revisionSession?.status === 'editing' && new Date(item.revisionSession.expiresAt) > now))) throw conflict('Respond to pending revision requests and allow open revision sessions to finish before opening the next round');
      const kept = await Submission.find({ projectId: project._id, roundId: previous._id, $or: [{ state: 'accepted' }, { state: 'retraction_requested', selectionMode: { $in: ['whole_take', 'selected_ranges'] } }] }).session(session).lean();
      const keptIds = kept.map(item => item.reservationId);
      const [round] = await Round.create([{ projectId: project._id, type, sequence: previous.sequence + 1, roleName: nextRole,
        state: 'open', slotLimit: 3, openedAt: now, closesAt: null, clockStartedAt: null }], { session });
      await Round.updateOne({ _id: previous._id }, { $set: { state: 'closed', closedAt: now, closeReason: 'next_round_opened', closureNotificationsPending: true } }, { session });
      const cancelled = await Reservation.updateMany({ roundId: previous._id, _id: { $nin: keptIds }, state: { $in: ['active', 'submitted'] } },
        { $set: { state: 'cancelled', slotHeld: false, endedByRoundAdvance: true, roundAdvanceClosedAt: now, extensionRequest: null } }, { session });
      await Submission.updateMany({ projectId: project._id, roundId: previous._id, state: 'submitted' }, { $set: {
        state: 'rejected', decisionNote: 'The owner selected another contribution and moved the project to the next round.', decidedAt: now,
        decidedBy: getOriginalsUserId(user), ownerNotificationPending: false,
      } }, { session });
      const unusedAssets = pending.flatMap(item => item.outputAssetId ? [item.outputAssetId] : originalTakeAssetIds(item.takes || []));
      if (unusedAssets.length) await Asset.updateMany({ _id: { $in: unusedAssets } }, { $set: { state: 'hidden' } }, { session });
      await Invitation.updateMany({ roundId: previous._id, state: { $in: ['pending', 'accepted'] } }, { $set: { state: 'cancelled' } }, { session });
      const completedRoles = accepted.filter(item => item.category === 'contribution').map(item => key(item.roleName));
      if (completedRoles.length) await Future.updateMany({ projectId: project._id, state: 'waiting', roleKey: { $in: completedRoles } }, { $set: { state: 'cancelled' } }, { session });
      project.currentRoundId = round._id;
      project.state = { instrument: 'role_round_open', mix: 'mix_open', master: 'master_open' }[type];
      await project.save({ session });
      await Event.create([{ projectId: project._id, roundId: round._id, actorId: getOriginalsUserId(user), type: 'round_opened', metadata: {
        roundType: type, roleName: nextRole, closedRoundId: String(previous._id), cancelledPlaces: cancelled.modifiedCount || 0,
      } }], { session });
      result = { round, project, closedRoundId: String(previous._id), cancelledPlaces: cancelled.modifiedCount || 0 };
    });
    return result;
  } finally { await session.endSession(); }
}
