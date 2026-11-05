import Invitation from '../models/originalInvitationModel.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Asset from '../models/originalAssetModel.js';
import Issue from '../models/originalIssueModel.js';
import Credit from '../models/originalCreditVersionModel.js';
import { getOriginalsUserId, isOriginalsEnabled } from './originalsPolicyService.js';
import { loadOriginalMembership, originalParticipation } from './originalsMembershipService.js';

// A private invitation grants its intended signed-in musician this project only.
// The participation middleware still enforces role loss on every request.
export async function allowOriginalInvitationRequest(req, now = new Date()) {
  if (!isOriginalsEnabled()) return false;
  const musicianId = getOriginalsUserId(req.user);
  if (!musicianId) return false;
  let projectId = req.path.match(/^\/projects\/([a-f\d]{24})(?:\/|$)/i)?.[1];
  if (!projectId) {
    const resource = req.path.match(/^\/(rounds|reservations|submissions|assets|issues|credit-versions)\/([^/]+)/);
    const models = { rounds: Round, reservations: Reservation, submissions: Submission, assets: Asset, issues: Issue, 'credit-versions': Credit };
    if (resource) projectId = (await models[resource[1]].findById(resource[2]).select('projectId').lean())?.projectId;
  }
  if (!projectId || !await Invitation.exists({ projectId, invitedMusicianId: musicianId })) return false;
  const project = await Project.findById(projectId).lean();
  if (!project || ['cancelled', 'archived'].includes(project.state)) return false;
  const snapshot = await loadOriginalMembership(project);
  const membership = originalParticipation(snapshot, musicianId, now);
  const current = snapshot.rounds.find(item => String(item._id) === String(project.currentRoundId));
  const invited = current && current.state !== 'closed' && snapshot.invitations.some(item => String(item.invitedMusicianId) === musicianId && String(item.roundId) === String(current._id) && ['pending', 'accepted'].includes(item.state) && (!item.expiresAt || new Date(item.expiresAt) > now));
  return Boolean(membership.canAccess && (membership.notify || invited));
}
