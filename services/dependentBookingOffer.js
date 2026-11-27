import mongoose from 'mongoose';
import Board from '../models/bookingBoardItem.js';
import Message from '../models/EnquiryMessage.js';
import { offerBookingRole } from '../controllers/allocationController.js';
import { activeBooking, confirmedAllocation, londonDay } from '../utils/bookingAllocationPolicy.js';

export function dependentOfferDecision(plan, board, now = new Date()) {
  if (!board || !activeBooking(board)) return 'booking-inactive';
  if (board.eventDateISO !== plan.dateISO || board.eventDateISO < londonDay(now)) return 'booking-date-changed';
  if (!(Number(plan.offer?.fee) > 0)) return 'fee-required';
  const members = board.assignedMusicians || [];
  const target = members.find(m => m.roleSlotId === plan.offer.roleSlotId);
  if (target && String(target.musicianId) !== String(plan.offer.musicianId)) return 'target-slot-changed';
  if (target && ['declined', 'unavailable', 'withdrawn', 'cancelled', 'replaced'].includes(target.status)) return 'target-unavailable';
  if (confirmedAllocation(target)) return 'already-confirmed';
  if (target?.status === 'offered') return 'target-already-offered';
  if (!(plan.requires?.length)) return 'prerequisite-required';
  const ready = plan.requires.every(required => members.some(member =>
    String(member.musicianId) === String(required.musicianId) &&
    member.roleSlotId === required.roleSlotId &&
    (!required.offerRequestId || member.offerRequestId === required.offerRequestId) &&
    confirmedAllocation(member)));
  return ready ? 'ready' : 'waiting';
}

// A persisted claim prevents duplicate sends. Ambiguous failures are held for
// review rather than retried: the provider may have accepted the message.
export function createDependentOfferRunner({ queue, loadBoard, findOffer, releaseHold, restoreHold, sendOffer }) {
  return async ({ now = new Date() } = {}) => {
    const results = [];
    const plans = await queue.find({ state: { $in: ['waiting', 'dispatching'] } }).limit(30).toArray();
    for (const plan of plans) {
      if (plan.state === 'dispatching' && plan.leaseUntil > now) continue;
      const existing = await findOffer(plan);
      if (existing) {
        await queue.updateOne({ _id: plan._id }, { $set: { state: 'offered', requestId: existing.enquiryId, messageSid: existing.messageSid, updatedAt: now } });
        results.push({ id: plan._id, state: 'offered' });
        continue;
      }
      if (plan.state === 'dispatching') {
        await queue.updateOne({ _id: plan._id, state: 'dispatching' }, { $set: { state: 'needs_review', reason: 'Previous send outcome is uncertain; no automatic resend.', updatedAt: now } });
        continue;
      }
      const board = await loadBoard(plan);
      const decision = dependentOfferDecision(plan, board, now);
      if (decision === 'waiting') continue;
      if (decision !== 'ready') {
        await queue.updateOne({ _id: plan._id, state: 'waiting' }, { $set: { state: decision === 'already-confirmed' ? 'complete' : 'needs_review', reason: decision, updatedAt: now } });
        continue;
      }
      const claimed = await queue.updateOne({ _id: plan._id, state: 'waiting' }, { $set: { state: 'dispatching', leaseUntil: new Date(now.getTime() + 120000), attemptedAt: now } });
      if (!claimed.modifiedCount) continue;
      try {
        // Recheck the accepted offer immediately before releasing this slot.
        if (dependentOfferDecision(plan, await loadBoard(plan), now) !== 'ready') {
          await queue.updateOne({ _id: plan._id }, { $set: { state: 'waiting', updatedAt: now } });
          continue;
        }
        await releaseHold(plan);
        const response = await sendOffer(plan);
        const sent = await findOffer(plan);
        if (!sent) throw Error(response?.message || 'No recorded allocation request after dispatch');
        await queue.updateOne({ _id: plan._id }, { $set: { state: 'offered', requestId: sent.enquiryId, messageSid: sent.messageSid, updatedAt: now } });
        results.push({ id: plan._id, state: 'offered' });
      } catch (error) {
        const sent = await findOffer(plan);
        if (!sent) await restoreHold(plan);
        await queue.updateOne({ _id: plan._id }, { $set: { state: 'needs_review', reason: error.message, ...(sent ? { requestId: sent.enquiryId, messageSid: sent.messageSid } : {}), updatedAt: now } });
        results.push({ id: plan._id, state: 'needs_review' });
      }
    }
    return results;
  };
}

export async function processDependentBookingOffers(options = {}) {
  const queue = mongoose.connection.db.collection('dependentbookingoffers');
  const runner = createDependentOfferRunner({
    queue,
    loadBoard: plan => Board.findById(plan.boardId).lean(),
    findOffer: plan => Message.findOne({ bookingBoardItemId: plan.boardId, roleSlotId: plan.offer.roleSlotId,
      musicianId: plan.offer.musicianId, 'meta.kind': 'booking', 'meta.MetaISODate': plan.dateISO,
      fee: String(plan.offer.fee), createdAt: { $gte: plan.authorizedAt },
      messageSid: { $nin: ['', null] } }).sort({ createdAt: -1 }).lean(),
    releaseHold: plan => Board.collection.updateOne({ _id: plan.boardId }, { $set: {
      'allocationHolds.$[slot].active': false,
      'allocationHolds.$[slot].releaseReason': 'Authorised dependent offer: prerequisite musician confirmed.',
    } }, { arrayFilters: [{ 'slot.roleSlotId': plan.offer.roleSlotId }] }),
    restoreHold: plan => Board.collection.updateOne({ _id: plan.boardId }, { $set: {
      'allocationHolds.$[slot].active': true,
      'allocationHolds.$[slot].reason': 'Dependent allocation request needs administrator review.',
    } }, { arrayFilters: [{ 'slot.roleSlotId': plan.offer.roleSlotId }] }),
    sendOffer: async plan => {
      let status = 200, data;
      const res = { status(code) { status = code; return this; }, json(value) { data = value; return this; } };
      await offerBookingRole({ body: { ...plan.offer, bookingBoardItemId: String(plan.boardId) } }, res);
      if (status !== 200 || !data?.success) throw Error(data?.message || 'Allocation request failed');
      return data;
    },
  });
  return runner(options);
}
