import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Board from '../models/bookingBoardItem.js';
import Act from '../models/actModel.js';
import Policy from '../models/actRosterPolicy.js';
import Booking from '../models/bookingModel.js';
import Message from '../models/EnquiryMessage.js';
import { planBookingRoleUpgrade } from '../utils/bookingRoleUpgrade.js';
import { bookingAssignments, confirmedAllocation, activeBooking, activeAllocationHold, londonDay, vocalistAllocationBlocked } from '../utils/bookingAllocationPolicy.js';
import { sameRosterPerson } from '../utils/rosterEligibility.js';
import { findPriorAvailabilityDecline } from './availabilityPriorDeclines.js';
import { syncConfirmedBookingAssignments } from './manualBookingConfirmation.js';
const queue = () => mongoose.connection.collection('bookingroleupgradetransfers');
const actId = board => board.actId || board.actsSummary?.[0]?.actId;

// Releasing duties never records a musician as unavailable for the date.
export async function reconcileBookingRoleUpgrade(boardId) {
  const board = await Board.findById(boardId).lean();
  if (!board || !activeBooking(board) || !actId(board)) return { changed: false };
  const policy = await Policy.findOne({ actId: actId(board) }).lean();
  if (!policy?.roleUpgradeTransfers?.length) return { changed: false };
  const act = await Act.findById(actId(board)).lean();
  const selectedId = String(board.lineupId || board.actsSummary?.[0]?.lineupId || '');
  const lineup = act?.lineups?.find(l => [l._id, l.lineupId].some(id => String(id) === selectedId));
  if (!lineup) return { changed: false };
  const unavailableMusicianIds = [];
  let plan;
  for (;;) {
    plan = planBookingRoleUpgrade({ board, lineup, policy, unavailableMusicianIds });
    const next = plan?.nextBass;
    if (!next?.musicianId) break;
    const declined = await findPriorAvailabilityDecline({ musicianId: next.musicianId,
      phone: next.phone, dateISO: board.eventDateISO, formattedAddress: board.address || board.venueAddress });
    const conflict = await Board.exists({ _id: { $ne: board._id }, eventDateISO: board.eventDateISO,
      bookingStatus: { $ne: 'cancelled' }, assignedMusicians: { $elemMatch: {
        musicianId: next.musicianId, status: { $in: ['accepted','confirmed'] } } } });
    if (!declined && !conflict) break;
    unavailableMusicianIds.push(String(next.musicianId));
  }
  if (!plan) return { changed: false };
  const castAssignments = plan.assignments.map(a => ({ ...a,
    ...(mongoose.isValidObjectId(a.musicianId) ? { musicianId: new mongoose.Types.ObjectId(a.musicianId) } : {}),
    ...(mongoose.isValidObjectId(a.originalBandMemberId) ? { originalBandMemberId: new mongoose.Types.ObjectId(a.originalBandMemberId) } : {}),
  }));
  const now = new Date();
  const transferId = crypto.createHash('sha256').update([String(board._id), plan.musicianId,
    String(board.updatedAt || ''), plan.fromRoleSlotId, selectedId].join('|')).digest('hex');
  const updatedAtMatch = board.updatedAt ? { updatedAt: board.updatedAt } : { updatedAt: { $exists: false } };
  const allocation = { ...(board.allocation || {}), status: 'in_progress', lastCheckedAt: now,
    notes: 'Lineup upgrade moved the vocalist out of bass. The next bass deputy is selected, subject to the normal availability and fee checks.' };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updated = await Board.collection.updateOne({ _id: board._id, ...updatedAtMatch,
        assignedMusicians: board.assignedMusicians ?? { $exists: false } }, { $set: {
        assignedMusicians: castAssignments, bookingMusicians: castAssignments,
        bandLineup: castAssignments, 'bookingDetails.assignedMusicians': castAssignments,
        ...(board.actsSummary?.length ? { 'actsSummary.0.lineupId': selectedId } : {}),
        allocation, updatedAt: now,
      } }, { session });
      if (updated.matchedCount !== 1) throw Error('The booking changed while transferring roles; refresh and retry.');
      const { assignments, ...audit } = plan;
      await queue().insertOne({ _id: transferId, boardId: board._id, actId: act._id,
        lineupId: lineup._id || lineup.lineupId, ...audit, state: 'awaiting_vocal_confirmation',
        createdAt: now, updatedAt: now }, { session });
      await Message.collection.updateMany({ bookingBoardItemId: board._id,
        roleSlotId: plan.released.roleSlotId || plan.fromRoleSlotId,
        musicianId: new mongoose.Types.ObjectId(plan.musicianId),
        $or: [{ reply: null }, { reply: { $exists: false } }] },
      { $set: { reply: 'withdrawn', repliedAt: now, status: 'read',
        'meta.roleTransferReason': 'Moved to vocals after a lineup upgrade' } }, { session });
    });
  } finally { await session.endSession(); }
  const saved = await Board.findById(board._id).lean();
  const bookingFilters = [board.bookingId, board.sourceBookingId].filter(id => mongoose.isValidObjectId(id)).map(_id => ({ _id }));
  if (board.bookingRef) bookingFilters.push({ bookingId: board.bookingRef });
  const booking = bookingFilters.length ? await Booking.findOne({ $or: bookingFilters }).lean() : null;
  await syncConfirmedBookingAssignments({ board: saved, booking, BookingModel: Booking });
  return { changed: true, board: saved, transferId };
}

export async function processPendingBookingRoleUpgrades({ now = new Date(), maxBatch = 30 } = {}) {
  const records = await queue().find({ state: { $in: ['awaiting_vocal_confirmation', 'dispatching'] },
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] }).limit(maxBatch).toArray();
  let dispatched = 0;
  for (const transfer of records) {
    const board = await Board.findById(transfer.boardId).lean();
    if (!board || !activeBooking(board)) {
      await queue().updateOne({ _id: transfer._id }, { $set: { state: 'cancelled', updatedAt: now } });
      continue;
    }
    const eventDay = String(board.eventDateISO || '').slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDay)) continue;
    if (eventDay < londonDay(now)) {
      await queue().updateOne({ _id: transfer._id }, { $set: { state: 'expired', updatedAt: now } });
      continue;
    }
    const assignments = bookingAssignments(board);
    const vocal = assignments.find(a => a.roleSlotId === transfer.toRoleSlotId && sameRosterPerson(a, { musicianId: transfer.musicianId }));
    if (!confirmedAllocation(vocal) || board.allocation?.managerApprovalRequired ||
      vocalistAllocationBlocked(board, transfer.fromRole) ||
      activeAllocationHold(board, transfer.fromRoleSlotId) || !(transfer.offerFee > 0)) continue;
    const bass = assignments.find(a => a.roleSlotId === transfer.fromRoleSlotId);
    if (confirmedAllocation(bass)) {
      await queue().updateOne({ _id: transfer._id }, { $set: { state: 'filled', updatedAt: now } });
      continue;
    }
    const reserved = await queue().updateOne({ _id: transfer._id,
      state: { $in: ['awaiting_vocal_confirmation', 'dispatching'] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
    { $set: { state: 'dispatching', leaseUntil: new Date(+now + 120000), updatedAt: now } });
    if (reserved.modifiedCount !== 1) continue;
    try {
      const { escalateToNextDeputy } = await import('../controllers/allocationController.js');
      const sent = await escalateToNextDeputy({ bookingBoardItemId: board._id,
        bookingRef: board.bookingRef, actId: transfer.actId, lineupId: transfer.lineupId,
        musicianId: transfer.musicianId, phone: transfer.released.phone || '',
        originalBandMemberId: transfer.originalBandMemberId, roleSlotId: transfer.fromRoleSlotId,
        duties: transfer.fromRole, fee: transfer.offerFee,
        formattedDate: board.eventDateISO, formattedAddress: board.address || board.venueAddress || '',
        meta: { kind: 'booking', role: transfer.fromRole, MetaISODate: board.eventDateISO,
          county: board.county || '', actName: board.actTscName || board.actName || '' },
      });
      await queue().updateOne({ _id: transfer._id }, { $set: {
        state: sent ? 'offered' : 'allocation_needs_review', updatedAt: new Date(),
      }, $unset: { leaseUntil: '' } });
      if (sent) dispatched++;
    } catch (error) {
      // The existing deputy chain owns retries after a request is created.
      await queue().updateOne({ _id: transfer._id }, { $set: {
        state: 'allocation_needs_review', error: error.message, updatedAt: new Date(),
      }, $unset: { leaseUntil: '' } });
    }
  }
  return { checked: records.length, dispatched };
}
