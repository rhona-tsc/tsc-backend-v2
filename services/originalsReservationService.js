import Notification from '../models/originalNotificationModel.js';
import { requireCurrentOriginalAgreement, originalAgreementType, getOriginalAgreement } from "./originalsAgreementService.js";
import { loadOriginalMembership, originalParticipation } from "./originalsMembershipService.js";
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Future from '../models/originalRoleReservationModel.js';
import { startOriginalRoundClock } from './originalsRoundClockService.js';
import { getReservationExpiry, isOriginalRoundExpired } from './originalsPolicyService.js';
export const roleKey = value => String(value || '').trim().toLowerCase();
const conflict = message => Object.assign(new Error(message), { status: 409 });
export const eligibleRoundRoles = round => round?.type === 'foundation' ? round.eligibleRoles || [] : round?.roleName ? [round.roleName] : [];

export async function createOriginalRecordingReservation({ round, musicianId, roleName, anonymous = false, creditName = '', agreementAcceptanceId, futureReservationId, now = new Date() }) {
  if (!['open','reopened'].includes(round.state) || isOriginalRoundExpired(round, now)) throw conflict('This round is closed');
  if (!eligibleRoundRoles(round).some(role => roleKey(role) === roleKey(roleName))) throw conflict('Choose a role in this round');
  await requireCurrentOriginalAgreement({ agreementAcceptanceId, projectId: round.projectId, musicianId, roleName, type: originalAgreementType(round) });
  if (futureReservationId) {
    const existing = await Reservation.findOne({ futureReservationId }).lean();
    if (existing) return { reservation: existing, round };
  }
  await Reservation.updateMany({ roundId: round._id, state: 'active', expiresAt: { $lte: now } }, { $set: { state: 'expired', slotHeld: false } });
  const failed = await Submission.find({ roundId: round._id, state: { $in: ['rejected','withdrawn','retracted'] } }).select('reservationId').lean();
  const failedIds = new Set(failed.map(item => String(item.reservationId)));
  for (let attempt = 0; attempt < round.slotLimit; attempt++) {
    const occupied = (await Reservation.find({ roundId: round._id, slotHeld: { $ne: false }, $or: [{ state: 'active', expiresAt: { $gt: now } }, { state: 'submitted' }] }).select('_id musicianId seatNumber state').lean()).filter(item => !failedIds.has(String(item._id)));
    if (occupied.some(item => String(item.musicianId) === String(musicianId))) throw conflict('You already have a reservation or submission in this round');
    if (occupied.length >= round.slotLimit) throw conflict('All places in this round are reserved');
    const used = new Set(occupied.map(item => item.seatNumber).filter(Boolean));
    // Legacy reservations have no numbered seat; still count them against capacity.
    for (const item of occupied.filter(item => !item.seatNumber)) { const seat = Array.from({ length: round.slotLimit }, (_, i) => i + 1).find(number => !used.has(number)); used.add(seat); }
    const seatNumber = Array.from({ length: round.slotLimit }, (_, i) => i + 1).find(number => !used.has(number));
    let reservation;
    try {
      reservation = await Reservation.create({ projectId: round.projectId, roundId: round._id, musicianId, roleName, anonymous, creditName, agreementAcceptanceId, seatNumber, slotHeld: true, ...(futureReservationId ? { futureReservationId } : {}), reservedAt: now, expiresAt: getReservationExpiry(now) });
    } catch (error) {
      if (error.code !== 11000) throw error;
      if (futureReservationId) { const existing = await Reservation.findOne({ futureReservationId }).lean(); if (existing) return { reservation: existing, round }; }
      continue;
    }
    try {
      const timed = await startOriginalRoundClock(round._id, now);
      if (!timed || isOriginalRoundExpired(timed, now)) throw conflict('This round has just closed');
      return { reservation, round: timed };
    } catch (error) {
      await Reservation.updateOne({ _id: reservation._id, state: 'active' }, { $set: { state: 'cancelled', slotHeld: false } });
      throw error;
    }
  }
  throw conflict('This place was just reserved. Please refresh and try again.');
}

export async function activateOriginalRoleReservations({ project, round, now = new Date() }) {
  if (!round || String(project.currentRoundId) !== String(round._id) || !['open','reopened'].includes(round.state) || isOriginalRoundExpired(round, now)) return;
  if (["cancelled","archived","paused","approved_master"].includes(project.state)) return;
  const waiting = await Future.find({ projectId: project._id, $or: [{ state: 'waiting' }, { state: 'activated', activeReservationId: null }], roleKey: { $in: eligibleRoundRoles(round).map(roleKey) } }).sort({ createdAt: 1, _id: 1 }).lean();
  if (!waiting.length) return;
  const snapshot = await loadOriginalMembership(project);
  for (const item of waiting) {
    try {
      if (String(project.ownerId) !== String(item.musicianId) && originalParticipation(snapshot, item.musicianId, now).blockedRoles.includes(roleKey(item.roleName))) {
        await Future.updateOne({ _id: item._id }, { $set: { state: 'cancelled' } }); continue;
      }
      // Finish interrupted linkage without treating an already-created timed reservation as fresh consent.
      if (item.state === 'activated') {
        const existing = await Reservation.findOne({ futureReservationId: item._id }).lean();
        if (existing) {
          if (String(existing.projectId) !== String(project._id) || String(existing.roundId) !== String(round._id) || String(existing.musicianId) !== String(item.musicianId) || roleKey(existing.roleName) !== roleKey(item.roleName)) throw conflict('Advance reservation linkage does not match this participant and round');
          await Future.updateOne({ _id: item._id, state: 'activated', activeReservationId: null }, { $set: { activeReservationId: existing._id } });
          continue;
        }
      }
      try { await requireCurrentOriginalAgreement({ agreementAcceptanceId: item.agreementAcceptanceId, projectId: project._id, musicianId: item.musicianId, roleName: item.roleName, type: originalAgreementType(round) }); }
      catch (error) {
        if (error.code !== 'ORIGINALS_AGREEMENT_REQUIRED') throw error;
        if (item.state === 'activated') await Future.updateOne({ _id: item._id, state: 'activated', activeReservationId: null, agreementAcceptanceId: item.agreementAcceptanceId || null }, { $set: { state: 'waiting' } });
        const current = getOriginalAgreement(originalAgreementType(round));
        const eventKey = `reservation-agreement-review:${item._id}:${round._id}:${current.textHash}`;
        await Notification.updateOne({ recipientMusicianId: item.musicianId, eventKey }, { $setOnInsert: { projectId: project._id, recipientMusicianId: item.musicianId, eventKey, template: 'originals_reservation_agreement_review', channels: ['email'], payload: { futureId: String(item._id), roundId: String(round._id), textHash: current.textHash }, state: 'queued', sendAfter: now } }, { upsert: true });
        continue;
      }
      // A release competes atomically with activation: mark it first, then recover safely on failure.
      const claimed = await Future.findOneAndUpdate({ _id: item._id, state: item.state, activeReservationId: null }, { $set: { state: 'activated' } }, { new: true }).lean();
      if (!claimed) continue;
      try {
        const { reservation } = await createOriginalRecordingReservation({ round, musicianId: item.musicianId, roleName: item.roleName, anonymous: item.anonymous, creditName: item.creditName, agreementAcceptanceId: item.agreementAcceptanceId, futureReservationId: item._id, now });
        await Future.updateOne({ _id: item._id, state: 'activated' }, { $set: { activeReservationId: reservation._id } });
      } catch (error) {
        await Future.updateOne({ _id: item._id, state: 'activated', activeReservationId: null }, { $set: { state: 'waiting' } });
        if (error.status !== 409) throw error;
      }
    } catch (error) { console.error('Advance Originals reservation activation will retry:', error); }
  }
}
