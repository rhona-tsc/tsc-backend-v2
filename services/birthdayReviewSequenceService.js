import { birthdayReviewPlan, isBirthdayBooking } from '../utils/birthdayReviewSequence.js';

export async function enableBirthdayReviewSequence({ bookingModel, bookingId, now = new Date() }) {
  const reject = (message, status) => { throw Object.assign(new Error(message), { status }); };
  const row = await bookingModel.findById(bookingId).lean();
  if (!row) reject('The booking was not found.', 404);
  if (!isBirthdayBooking(row)) reject('This review sequence is only for birthday bookings.', 400);
  if (row.reviewRequestPlan?.enabled === true) reject('This booking already has a saved review sequence. Refresh to view it.', 409);
  const updated = await bookingModel.findOneAndUpdate({
    _id: bookingId,
    eventType: row.eventType,
    'reviewRequestPlan.enabled': { $ne: true },
  }, { $set: { reviewRequestPlan: birthdayReviewPlan(now) } }, { new: true, runValidators: true }).lean();
  if (!updated) reject('The booking changed. Refresh before setting up its review sequence.', 409);
  return updated;
}
