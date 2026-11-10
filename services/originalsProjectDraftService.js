import mongoose from 'mongoose';
import Project from '../models/originalProjectModel.js';
import Asset from '../models/originalAssetModel.js';
import Future from '../models/originalRoleReservationModel.js';
import Event from '../models/originalEventModel.js';
import { originalOwnerAgreementAcceptance } from './originalsAgreementService.js';
import { originalPreferredPlaces, validateOriginalPreferredMusicians, saveOriginalPreferredPlaces } from './originalsPreferredPlacesService.js';
import { validateOriginalTemporaryStem } from './originalsTemporaryStemService.js';

export const originalStartingKinds = ['initial_stem', 'temporary_stem', 'guide_track', 'demo', 'voice_note', 'video_submission', 'click_track'];
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const key = value => String(value || '').trim().toLowerCase();
const own = (project, musicianId) => {
  if (!project) throw fail('Project not found.', 404);
  if (String(project.ownerId) !== String(musicianId)) throw fail('Only the project owner can edit this submission.', 403);
};
const editable = project => {
  if (!['draft', 'changes_requested'].includes(project.state) || project.currentRoundId || project.publishedAt) throw fail('This project has already been approved or is no longer an editable submission. Refresh your projects.');
};
const read = async (project, session) => ({
  project,
  assets: await Asset.find({ projectId: project._id, ownerId: project.ownerId, kind: { $in: originalStartingKinds }, state: 'active' }).session(session).lean(),
  preferredPlaces: await Future.find({ projectId: project._id, assignedByOwner: true, state: 'waiting' }).session(session).lean(),
});

export async function beginOriginalDraftEdit({ projectId, musicianId }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const project = await Project.findById(projectId).session(session);
      own(project, musicianId);
      if (project.state === 'pending_moderation' && project.moderation?.status === 'pending' && !project.currentRoundId && !project.publishedAt) {
        const previousModeration = project.moderation.toObject ? project.moderation.toObject() : { ...project.moderation };
        project.state = 'draft'; project.moderation.status = 'not_submitted'; project.moderation.launchEmailPending = false;
        if (typeof project.increment === 'function') project.increment(); else project.__v = (project.__v || 0) + 1;
        await project.save({ session });
        await Event.create([{ projectId, type: 'project_reopened_for_editing', actorId: musicianId, fromState: 'pending_moderation', toState: 'draft', metadata: { previousModeration } }], { session });
      }
      editable(project);
      result = await read(project, session);
    });
    return result;
  } finally { await session.endSession(); }
}

export async function saveOriginalDraftEdit({ projectId, musicianId, user, fields, input }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const project = await Project.findById(projectId).session(session);
      own(project, musicianId); editable(project);
      Object.assign(project, fields);
      const existing = await Asset.find({ projectId, ownerId: musicianId, kind: { $in: originalStartingKinds }, state: 'active' }).session(session).lean();
      if (!Array.isArray(input.assets)) throw fail('Include the starting files you want to keep.', 400);
      const ids = input.assets.map(item => String(item.assetId || ''));
      if (new Set(ids).size !== ids.length || ids.some(id => !existing.some(asset => String(asset._id) === id))) throw fail('A starting file is no longer available in this draft. Reload it before saving.', 400);
      for (const item of input.assets) {
        const asset = existing.find(asset => String(asset._id) === String(item.assetId));
        if (!originalStartingKinds.includes(item.kind)) throw fail('Choose a valid starting-file type.', 400);
        if (asset.mimeType?.startsWith('video/') && item.kind !== 'video_submission') throw fail('Video files must stay reference videos.', 400);
        if (item.kind === 'initial_stem' && item.finalStemConfirmed !== true) throw fail('Confirm which stems are intended for the final track.', 400);
        const replacementRoleName = item.kind === 'temporary_stem' ? validateOriginalTemporaryStem(project, item.replacementRoleName) : '';
        const stem = ['initial_stem', 'temporary_stem', 'click_track'].includes(item.kind);
        if (stem && typeof item.createdEntirelyWithAi !== 'boolean') throw fail('Use a true or false AI declaration for each stem.', 400);
        await Asset.updateOne({ _id: asset._id, projectId, ownerId: musicianId, state: 'active' }, { $set: {
          kind: item.kind, replacementRoleName, finalEligible: item.kind === 'initial_stem',
          ...(stem ? { createdEntirelyWithAi: item.createdEntirelyWithAi } : {}),
        } }, { session });
      }
      const removed = existing.filter(asset => !ids.includes(String(asset._id)));
      if (removed.length) await Asset.updateMany({ _id: { $in: removed.map(asset => asset._id) }, projectId, ownerId: musicianId }, { $set: { state: 'deleted' } }, { session });
      project.initialAssetIds = input.assets.map(item => item.assetId);
      if (input.preferredMusicians !== undefined) {
        const places = originalPreferredPlaces(input.preferredMusicians, project.requestedRoles, project.sourceType);
        await validateOriginalPreferredMusicians(places, user);
        const prior = await Future.find({ projectId, assignedByOwner: true, state: 'waiting' }).session(session).lean();
        const signature = values => values.map(item => `${key(item.roleName)}:${item.musicianId}`).sort().join('|');
        if (signature(prior) !== signature(places)) {
          await Future.updateMany({ projectId, assignedByOwner: true, state: 'waiting' }, { $set: { state: 'cancelled' } }, { session });
          await saveOriginalPreferredPlaces({ projectId, places, session });
        }
      }
      if (input.ownerAgreementAccepted === true) {
        const acceptance = originalOwnerAgreementAcceptance(input); acceptance.projectTitle = project.title;
        if (project.ownerAgreement?.accepted) { project.ownerAgreementHistory ||= []; project.ownerAgreementHistory.push(project.ownerAgreement.toObject ? project.ownerAgreement.toObject() : { ...project.ownerAgreement }); }
        project.ownerAgreement = acceptance;
      }
      if (typeof project.increment === 'function') project.increment(); else project.__v = (project.__v || 0) + 1;
      await project.save({ session });
      await Event.create([{ projectId, type: 'project_draft_edited', actorId: musicianId, metadata: { assets: input.assets, removedAssetIds: removed.map(asset => asset._id) } }], { session });
      result = await read(project, session);
    });
    return result;
  } finally { await session.endSession(); }
}
