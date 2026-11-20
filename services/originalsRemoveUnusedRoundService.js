import mongoose from 'mongoose';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Future from '../models/originalRoleReservationModel.js';
import Asset from '../models/originalAssetModel.js';
import Event from '../models/originalEventModel.js';
import { originalRoleManagement, sameOriginalRole } from './originalsRoleManagementService.js';
import { canManageOriginalProject, getOriginalsUserId } from './originalsPolicyService.js';

const conflict = message => Object.assign(new Error(message), { status: 409 });

// Retain the cancelled round and its audit trail. A round that has ever had a
// reservation or submission cannot be removed through this unused-round path.
export async function removeUnusedOriginalRound({ projectId, fromRoundId, roleName, user, now = new Date() }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const project = await Project.findById(projectId).session(session);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      if (!canManageOriginalProject(project, user)) throw Object.assign(new Error('Only the project owner or TSC can remove parts'), { status: 403 });
      if (String(project.currentRoundId) !== String(fromRoundId)) throw conflict('The current round changed. Refresh before removing this part.');
      const snapshot = { project };
      for (const [field, Model] of [['rounds', Round], ['reservations', Reservation], ['submissions', Submission], ['invitations', Invitation], ['futureReservations', Future], ['assets', Asset]]) {
        snapshot[field] = await Model.find({ projectId }).session(session).lean();
      }
      const rule = originalRoleManagement(snapshot, now).roles.find(role => sameOriginalRole(role.name, roleName));
      if (!rule?.canRemove || !rule.removesCurrentRound) throw conflict(rule?.removeReason || 'Only an unused current instrument round can be removed.');
      const previousRoles = project.requestedRoles.map(role => role.toObject ? role.toObject() : { ...role });
      const previous = snapshot.rounds.find(round => String(round._id) === String(fromRoundId));
      const closed = await Round.updateOne({ _id: previous._id, state: previous.state, clockStartedAt: null }, {
        $set: { state: 'cancelled', closedAt: now, closeReason: 'requested_part_removed', closureNotificationsPending: false },
      }, { session });
      if (!closed.matchedCount) throw conflict('Someone has started this round. Refresh before changing its parts.');
      project.requestedRoles = previousRoles.filter(role => !sameOriginalRole(role.name, roleName)).map((role, order) => ({ ...role, order }));
      project.state = 'owner_review';
      await project.save({ session });
      await Event.create([{ projectId, roundId: previous._id, type: 'project_role_removed', actorId: getOriginalsUserId(user),
        metadata: { roleName: rule.name, previousRoles, requestedRoles: project.requestedRoles, unusedRoundCancelled: true } }], { session });
      result = { requestedRoles: project.requestedRoles, removedCurrentRound: true,
        message: `${rule.name} removed. Choose the next recording round when you are ready.` };
    });
    return result;
  } finally { await session.endSession(); }
}
