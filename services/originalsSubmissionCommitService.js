import mongoose from 'mongoose';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Asset from '../models/originalAssetModel.js';
import { requireOriginalStemReviews } from './originalsRecordingContextService.js';
import { originalTakeAssetIds, originalTakeKindsValid, originalTakeNeedsListeningMix } from './originalsTakeFilesService.js';
const closed = () => Object.assign(new Error('This round has closed; it no longer accepts submissions'), { status: 409 });

export const originalSubmissionCommit = {
  async run({ reservationId, musicianId, payload, now = new Date() }) {
    const session = await mongoose.startSession();
    let saved;
    try {
      await session.withTransaction(async () => {
        const reservation = await Reservation.findOne({ _id: reservationId, musicianId, state: 'active', expiresAt: { $gt: now } }).session(session);
        if (!reservation) throw closed();
        const round = await Round.findById(reservation.roundId).session(session);
        if (!round || !['open', 'reopened', 'review'].includes(round.state) || round.closeReason === 'next_round_opened') throw closed();
        const project = await Project.findOne({ _id: reservation.projectId, currentRoundId: round._id }).session(session);
        if (!project) throw closed();
        const production = ['mix', 'master'].includes(payload.category);
        if (production ? round.type !== payload.category : !['foundation', 'instrument'].includes(round.type)) throw closed();
        const ids = production ? [payload.outputAssetId] : originalTakeAssetIds(payload.takes);
        const assets = await Asset.find({ _id: { $in: ids }, ownerId: musicianId, reservationId, state: 'active' }).session(session).lean();
        const listeningMixRequired = originalTakeNeedsListeningMix(round);
        if (assets.length !== new Set(ids.map(String)).size || (production ? assets[0]?.kind !== round.type : !originalTakeKindsValid(payload.takes, assets, { listeningMixRequired }))) throw Object.assign(new Error('The submitted files are no longer available'), { status: 409 });
        if (!production) await requireOriginalStemReviews({ assets, musicianId, session });
        // Both submission and advancement write this round. A concurrent closure
        // forces a retry against the closed round instead of admitting a late take.
        const claimed = await Round.updateOne(
          { _id: round._id, state: { $in: ['open', 'reopened', 'review'] }, closeReason: { $ne: 'next_round_opened' } },
          { $inc: { submissionSerial: 1 }, $set: { lastSubmissionAt: now } }, { session },
        );
        if (claimed.matchedCount !== 1) throw closed();
        [saved] = await Submission.create([{ ...payload, listeningMixRequired, ownerNotificationPending: true, submittedChatPending: !production }], { session });
        reservation.state = 'submitted';
        await reservation.save({ session });
      });
      return saved;
    } finally { await session.endSession(); }
  },
};
