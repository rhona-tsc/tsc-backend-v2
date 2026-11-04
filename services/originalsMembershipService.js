import Future from "../models/originalRoleReservationModel.js";
import { originalRoleProgress } from "./originalsRoleProgressService.js";
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import { canManageOriginalProject, getOriginalsUserId } from './originalsPolicyService.js';

const key = value => String(value || '');
const roleKey = value => String(value || '').trim().toLowerCase();
const retained = item => item.state === 'accepted' || (item.state === 'retraction_requested' && ['whole_take', 'selected_ranges'].includes(item.selectionMode));

export function originalParticipation(snapshot, musicianId, now = new Date()) {
  const { project, rounds = [], reservations = [], submissions = [], invitations = [], futureReservations = [] } = snapshot;
  const id = key(musicianId);
  const mine = submissions.filter(item => key(item.musicianId) === id);
  const bookings = reservations.filter(item => key(item.musicianId) === id);
  const roundMap = new Map(rounds.map(round => [key(round._id), round]));
  const current = roundMap.get(key(project.currentRoundId));
  // A round in review is still deciding its winners. Merely reaching its deadline is not rejection.
  const inCurrent = item => key(item.roundId) === key(project.currentRoundId) && current && current.state !== 'closed';
  const failed = item => ['rejected', 'withdrawn', 'retracted'].includes(item.state) || (!retained(item) && (!inCurrent(item)));
  const losses = [...mine.filter(failed), ...bookings.filter(item => !inCurrent(item) && !mine.some(sub => key(sub.reservationId) === key(item._id) && retained(sub)))];
  const validInvitations = invitations.filter(item => key(item.invitedMusicianId) === id && inCurrent(item) && ['pending', 'accepted'].includes(item.state) && (!item.expiresAt || new Date(item.expiresAt) > now));
  // A fresh owner invitation can restore a role, but an old invitation cannot undo a rejection.
  const invitedFor = role => validInvitations.some(invite => roleKey(invite.roleName) === roleKey(role) && losses.filter(loss => roleKey(loss.roleName) === roleKey(role)).every(loss => key(loss.roundId) !== key(invite.roundId) || new Date(invite.createdAt || 0) > new Date(loss.decidedAt || loss.updatedAt || loss.createdAt || now)));
  const blockedRoles = [...new Set(losses.map(item => roleKey(item.roleName)).filter(Boolean))].filter(role => !invitedFor(role));
  const accepted = mine.some(retained);
  const awaiting = mine.some(item => ['submitted', 'retraction_requested'].includes(item.state) && inCurrent(item) && !blockedRoles.includes(roleKey(item.roleName)));
  const active = bookings.some(item => item.state === 'active' && new Date(item.expiresAt) > now && inCurrent(item) && !blockedRoles.includes(roleKey(item.roleName)) && !mine.some(sub => key(sub.reservationId) === key(item._id) && failed(sub)));
  const waiting = futureReservations.some(item => key(item.musicianId) === id && item.state === "waiting" && !blockedRoles.includes(roleKey(item.roleName)));
  const owner = key(project.ownerId) === id;
  return {
    canAccess: owner || accepted || awaiting || active || waiting || validInvitations.some(invite => invitedFor(invite.roleName)) || !losses.length,
    notify: owner || accepted || awaiting || active || waiting,
    blockedRoles,
  };
}

export async function loadOriginalMembership(project) {
  const projectId = project._id;
  const [rounds, reservations, submissions, invitations, futureReservations] = await Promise.all([
    Round.find({ projectId }).select('_id state').lean(),
    Reservation.find({ projectId }).select('_id musicianId roundId roleName state expiresAt anonymous creditName createdAt updatedAt').lean(),
    Submission.find({ projectId }).select('musicianId roundId reservationId roleName state selectionMode decidedAt createdAt updatedAt').lean(),
    Invitation.find({ projectId }).select('invitedMusicianId roundId roleName state expiresAt createdAt').lean(),
    Future.find({ projectId, state: 'waiting' }).select('musicianId roleName state').lean(),
  ]);
  return { project, rounds, reservations, submissions, invitations, futureReservations };
}

export const originalChatRecipients = (snapshot, authorId, now = new Date()) => [...new Set([
  key(snapshot.project.ownerId), ...snapshot.reservations.map(item => key(item.musicianId)), ...snapshot.submissions.map(item => key(item.musicianId)), ...(snapshot.futureReservations || []).map(item => key(item.musicianId)),
])].filter(id => id && id !== key(authorId) && originalParticipation(snapshot, id, now).notify);

export async function requireOriginalParticipation(req, res, next) {
  try {
    let projectId = req.params.id;
    let targetRole = req.body?.roleName;
    const resources = { roundId: Round, reservationId: Reservation, submissionId: Submission };
    for (const [param, Model] of Object.entries(resources)) {
      if (req.params[param]) {
        const resource = await Model.findById(req.params[param]).select('projectId roleName').lean();
        projectId = resource?.projectId;
        targetRole ||= resource?.roleName;
      }
    }
    // Asset / issue / credit models are injected by the route adapter below.
    if (req.originalProjectId) projectId = req.originalProjectId;
    const project = projectId ? await Project.findById(projectId).lean() : null;
    if (!project) return res.status(404).json({ success: false, message: 'Originals project not found' });
    if (canManageOriginalProject(project, req.user)) return next();
    const snapshot = await loadOriginalMembership(project);
    const membership = originalParticipation(snapshot, getOriginalsUserId(req.user));
    if (req.originalReferralRoles && !membership.notify && !originalRoleProgress(snapshot).some(role => role.canRecommend && req.originalReferralRoles.some(name => roleKey(name) === roleKey(role.name)))) membership.canAccess = false;
    if (!membership.canAccess) return res.status(403).json({ success: false, code: 'ORIGINALS_PARTICIPATION_ENDED', message: 'You were not selected to continue in this project. Project and chat access have ended.' });
    if (/\/reservations\/?$/.test(req.path) && req.method === 'POST' && membership.blockedRoles.includes(roleKey(targetRole))) return res.status(403).json({ success: false, code: 'ORIGINALS_ROLE_ENDED', message: 'Your participation in this role has ended. The owner would need to invite you again.' });
    req.originalMembership = membership;
    next();
  } catch (error) {
    console.error('Originals participation check failed:', error);
    return res.status(500).json({ success: false, message: 'Could not check project access' });
  }
}
