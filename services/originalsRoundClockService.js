import originalInvitationModel from '../models/originalInvitationModel.js';
import originalRoundModel from '../models/originalRoundModel.js';
import originalReservationModel from '../models/originalReservationModel.js';
import originalSubmissionModel from '../models/originalSubmissionModel.js';
import originalProjectModel from '../models/originalProjectModel.js';
import { getOriginalRoundDeadline } from './originalsPolicyService.js';

const projectRoundState = type => ({ foundation: 'foundation_open', instrument: 'role_round_open', mix: 'mix_open', master: 'master_open' })[type];

// Repair only an idle current window left behind by the old publication-based
// timer. A round with activity or an explicit owner closure is never reopened.
export async function prepareOriginalRoundClock(round) {
  if (!round || round.clockStartedAt) return round;
  const expiredWithoutClock = round.state === 'review' && round.closeReason === 'seven_day_window_ended';
  if (!['open', 'reopened'].includes(round.state) && !expiredWithoutClock) return round;
  const firstReservation = await originalReservationModel.findOne({
    roundId: round._id,
    reservedAt: { $gte: round.openedAt || new Date(0) },
    state: { $ne: 'cancelled' },
  }).sort({ reservedAt: 1 }).lean();
  if (firstReservation) {
    return await originalRoundModel.findOneAndUpdate({ _id: round._id, clockStartedAt: null }, {
      $set: { clockStartedAt: firstReservation.reservedAt, closesAt: getOriginalRoundDeadline(firstReservation.reservedAt) },
    }, { new: true }) || await originalRoundModel.findById(round._id);
  }
  if (await originalSubmissionModel.exists({ roundId: round._id })) return round;
  if (!round.closesAt && !expiredWithoutClock) return round;
  const updated = await originalRoundModel.findOneAndUpdate({
    _id: round._id, clockStartedAt: null, state: round.state,
  }, { $set: { closesAt: null, closedAt: null, closeReason: '', state: expiredWithoutClock ? 'open' : round.state } }, { new: true });
  if (updated && expiredWithoutClock) {
    await originalProjectModel.updateOne({ _id: round.projectId, currentRoundId: round._id, state: 'owner_review' }, {
      $set: { state: projectRoundState(round.type) },
    });
  }
  return updated || await originalRoundModel.findById(round._id);
}

export async function startOriginalRoundClock(roundId, reservedAt) {
  // Compare-and-set makes simultaneous first reservations share one deadline.
  const started = await originalRoundModel.findOneAndUpdate({
    _id: roundId, state: { $in: ['open', 'reopened'] }, clockStartedAt: null,
  }, { $set: { clockStartedAt: reservedAt, closesAt: getOriginalRoundDeadline(reservedAt) } }, { new: true });
  if (started) {
    await originalInvitationModel.updateMany({ roundId, state: 'pending' }, { $set: { expiresAt: started.closesAt } });
    return started;
  }
  return originalRoundModel.findOne({ _id: roundId, state: { $in: ['open', 'reopened'] } });
}
