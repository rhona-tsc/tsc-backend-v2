import { getOriginalAgreement, recordOriginalAgreement } from "../services/originalsAgreementService.js";
import { activateOriginalRoleReservations } from "../services/originalsReservationService.js";
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Future from '../models/originalRoleReservationModel.js';
import Notification from '../models/originalNotificationModel.js';
import { getOriginalsUserId } from '../services/originalsPolicyService.js';
import { roleKey, eligibleRoundRoles } from '../services/originalsReservationService.js';
export async function reserveFutureOriginalRole(req, res) {
  try {
    const project = await Project.findById(req.params.id).lean();
    if (!project || !['live','foundation_open','role_round_open','owner_review'].includes(project.state)) return res.status(409).json({ success: false, message: 'This project is not accepting advance reservations' });
    const role = (project.requestedRoles || []).find(item => roleKey(item.name) === roleKey(req.body.roleName));
    if (!role || req.originalMembership?.blockedRoles.includes(roleKey(role.name))) return res.status(403).json({ success: false, message: 'This role is not available to reserve' });
    const round = project.currentRoundId ? await Round.findById(project.currentRoundId).lean() : null;
    if (round && eligibleRoundRoles(round).some(name => roleKey(name) === roleKey(role.name)) && ['open','reopened','review'].includes(round.state)) return res.status(409).json({ success: false, message: 'This role is already in the current round. Use the current round reservation.' });
    const { default: Submission } = await import('../models/originalSubmissionModel.js');
    if (await Submission.exists({ projectId: project._id, roleName: role.name, state: 'accepted' })) return res.status(409).json({ success: false, message: 'This role already has an approved recording' });
    const musicianId = getOriginalsUserId(req.user);
    const existing = await Future.findOne({ projectId: project._id, musicianId, roleKey: roleKey(role.name), state: 'waiting' }).lean();
    if (existing) return res.status(409).json({ success: false, message: 'You already have an advance place for this role.' });
    const anonymous = req.body.anonymous === true, creditName = String(req.body.creditName || '').trim();
    if (anonymous && !creditName) return res.status(400).json({ success: false, message: 'Enter an artistic name for anonymous credits' });
    const agreement = await recordOriginalAgreement({ input: req.body.agreement, projectId: project._id, projectTitle: project.title, musicianId, roleName: role.name });
    for (let seatNumber = 1; seatNumber <= 3; seatNumber++) {
      try {
        const reservation = await Future.create({ projectId: project._id, musicianId, roleName: role.name, roleKey: roleKey(role.name), seatNumber, anonymous, creditName, agreementAcceptanceId: agreement._id, agreementVersion: agreement.version, agreementTextHash: agreement.textHash });
        // Share the plan version with role edits: either this hold protects
        // the role from removal, or a concurrent removal cancels this hold.
        const plan = await Project.updateOne({ _id: project._id, currentRoundId: project.currentRoundId, state: project.state, 'requestedRoles.name': role.name }, { $inc: { __v: 1 } });
        if (!plan.matchedCount) {
          await Future.updateOne({ _id: reservation._id, state: 'waiting' }, { $set: { state: 'cancelled' } });
          return res.status(409).json({ success: false, message: 'The project round or parts have changed. Refresh before reserving.' });
        }
        return res.status(201).json({ success: true, reservation });
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    return res.status(409).json({ success: false, message: 'All three advance places for this role are reserved' });
  } catch (error) { if (error.status) return res.status(error.status).json({ success: false, message: error.message, code: error.code }); console.error('Advance reservation failed:', error); return res.status(500).json({ success: false, message: 'Could not reserve this future role' }); }
}

export async function releaseFutureOriginalRole(req, res) {
  try {
  const reservation = await Future.findOneAndUpdate({ _id: req.params.futureId, projectId: req.params.id, musicianId: getOriginalsUserId(req.user), state: 'waiting' }, { $set: { state: 'released' } }, { new: true }).lean();
  if (!reservation) return res.status(409).json({ success: false, message: 'This reservation is no longer waiting. Refresh the project; if its round has opened, release the recording reservation instead.' });
  return res.json({ success: true, reservation });
  } catch { return res.status(500).json({ success: false, message: "Could not release this advance place" }); }
}

export async function releaseOriginalReservation(req, res) {
  try {
    const reservation = await Reservation.findOneAndUpdate({ _id: req.params.reservationId, musicianId: getOriginalsUserId(req.user), state: 'active' }, { $set: { state: 'released', slotHeld: false, extensionRequest: null } }, { new: true }).lean();
    if (!reservation) return res.status(409).json({ success: false, message: 'Only your own unsubmitted recording reservation can be released' });
    await Notification.updateMany({ projectId: reservation.projectId, recipientMusicianId: reservation.musicianId, template: 'originals_reserved_round_open', 'payload.reservationId': String(reservation._id), state: 'queued' }, { $set: { state: 'cancelled' } }).catch(error => console.error('Released reservation email cancellation will be rechecked at delivery:', error));
    return res.json({ success: true, reservation });
  } catch (error) { console.error('Release reservation failed:', error); return res.status(500).json({ success: false, message: 'Could not release this reservation' }); }
}

// The same protected project scope applies to invited participants and preview users.
export function getOriginalReservationAgreements(_req, res) {
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, agreements: ['contributor', 'mix', 'master'].map(type => getOriginalAgreement(type)) });
}

export async function renewFutureOriginalAgreement(req, res) {
  try {
    const musicianId = getOriginalsUserId(req.user);
    const existing = await Future.findOne({ _id: req.params.futureId, projectId: req.params.id, musicianId, state: 'waiting' }).lean();
    if (!existing) return res.status(409).json({ success: false, message: 'This advance place is no longer waiting. Refresh the project.' });
    const project = await Project.findById(req.params.id).lean();
    const agreement = await recordOriginalAgreement({ input: req.body.agreement, projectId: req.params.id, projectTitle: project?.title || '', musicianId, roleName: existing.roleName });
    // Retain the old acceptance in the append-only evidence collection.
    const reservation = await Future.findOneAndUpdate({ _id: existing._id, musicianId, state: 'waiting' }, { $set: { agreementAcceptanceId: agreement._id, agreementVersion: agreement.version, agreementTextHash: agreement.textHash } }, { new: true }).lean();
    if (!reservation) return res.status(409).json({ success: false, message: 'This place has changed. Refresh the project.' });
    const round = project?.currentRoundId ? await Round.findById(project.currentRoundId).lean() : null;
    if (project && round) await activateOriginalRoleReservations({ project, round });
    return res.json({ success: true, reservation });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not save agreement acceptance', code: error.code }); }
}
