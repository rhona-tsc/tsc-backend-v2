import { originalRevisionEditing } from './originalsRevisionService.js';
import mongoose from 'mongoose';
import Asset from '../models/originalAssetModel.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Event from '../models/originalEventModel.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });

export async function deleteOriginalDraftAsset({ assetId, musicianId, now = new Date() }) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const asset = await Asset.findOne({ _id: assetId, ownerId: musicianId, state: 'active' }).session(session);
      if (!asset) throw fail('Uploaded recording not found', 404);
      if (!['take_stem', 'take_mixdown', 'mix', 'master'].includes(asset.kind)) throw fail('Only unsubmitted recordings can be deleted here');
      const reservation = await Reservation.findOne({ _id: asset.reservationId, projectId: asset.projectId, musicianId, state: { $in: ['active', 'submitted'] }, expiresAt: { $gt: now } }).session(session);
      if (!reservation) throw fail('Only recordings from your active, unsubmitted reservation can be deleted');
      const project = await Project.findOne({ _id: asset.projectId, currentRoundId: reservation.roundId }).session(session);
      if (!project || (project.initialAssetIds || []).some(id => String(id) === String(assetId))) throw fail('This recording cannot be deleted');
      const existing = await Submission.findOne({ reservationId: reservation._id }).session(session);
      if ((reservation.state === 'submitted' && !existing) || (existing && !originalRevisionEditing(existing, now))) throw fail('Reopen the recording session before deleting draft uploads');
      const used = await Submission.exists({ $or: [
        { outputAssetId: assetId }, { 'previousVersions.outputAssetId': assetId }, { 'previousVersions.takes.stemAssetId': assetId }, { 'previousVersions.takes.stemAssetIds': assetId }, { 'previousVersions.takes.wetStemAssetId': assetId }, { 'previousVersions.takes.mixdownAssetId': assetId },
        { 'takes.stemAssetId': assetId }, { 'takes.stemAssetIds': assetId },
        { 'takes.mixdownAssetId': assetId }, { 'takes.wetStemAssetId': assetId },
      ] }).session(session);
      if (used) throw fail('A recording already submitted for review cannot be deleted here');
      // Submission and round advancement write this same round. A concurrent
      // submission forces a transaction retry before a file can be removed.
      const claimed = await Round.updateOne({ _id: reservation.roundId, projectId: project._id, state: { $in: ['open', 'reopened', 'review'] }, closeReason: { $ne: 'next_round_opened' } }, { $inc: { submissionSerial: 1 } }, { session });
      if (claimed.matchedCount !== 1) throw fail('This recording round has closed');
      const removed = await Asset.updateOne({ _id: assetId, ownerId: musicianId, state: 'active' }, { $set: { state: 'deleted' } }, { session });
      if (removed.matchedCount !== 1) throw fail('The uploaded recording has changed; refresh and try again');
      await Event.create([{ projectId: project._id, roundId: reservation.roundId, actorId: musicianId, type: 'draft_asset_deleted', metadata: { assetId: String(assetId), reservationId: String(reservation._id) } }], { session });
    });
  } finally { await session.endSession(); }
}
