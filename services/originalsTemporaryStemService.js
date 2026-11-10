import mongoose from 'mongoose';
import Project from '../models/originalProjectModel.js';
import Asset from '../models/originalAssetModel.js';
import { loadOriginalRecordingContext } from './originalsRecordingContextService.js';

const roleKey = value => String(value || '').trim().toLowerCase();
const recordingStates = new Set(['draft', 'changes_requested', 'live', 'foundation_open', 'role_round_open', 'owner_review']);

export function validateOriginalTemporaryStem(project, roleName) {
  if (!recordingStates.has(project.state)) throw Object.assign(new Error('Temporary stems can only be added while planning or recording, before the final mix.'), { status: 409 });
  const role = (project.requestedRoles || []).find(role => roleKey(role.name) === roleKey(roleName));
  if (!role) throw Object.assign(new Error('Choose the project role whose approved recording will replace this temporary stem.'), { status: 400 });
  return role.name;
}

export async function saveOriginalTemporaryStem({ projectId, data, songwritingClaim }) {
  const session = await mongoose.startSession();
  let asset;
  try {
    await session.withTransaction(async () => {
      const project = await Project.findById(projectId).session(session);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      const replacementRoleName = validateOriginalTemporaryStem(project, data.replacementRoleName);
      [asset] = await Asset.create([{ ...data, replacementRoleName, finalEligible: false, state: 'active' }], { session });
      project.initialAssetIds = [...(project.initialAssetIds || []), asset._id];
      project.hasInitialStem = true;
      if (project.sourceType !== 'final_eligible_stem') project.sourceType = 'temporary_stem';
      if (songwritingClaim !== undefined) project.ownerSongwritingClaim = [true, 'true'].includes(songwritingClaim);
      if (typeof project.increment === 'function') project.increment(); else project.__v = (project.__v || 0) + 1;
      // The same project write is also used by round advancement, so a late
      // upload cannot slip in after the final-mix replacement check.
      await project.save({ session });
    });
    return asset;
  } finally { await session.endSession(); }
}

export async function requireOriginalTemporaryReplacements({ projectId, session }) {
  let query = Asset.find({ projectId, kind: 'temporary_stem', state: 'active' }).select('_id');
  if (session) query = query.session(session);
  if (!(await query.lean()).length) return;
  const { tracks } = await loadOriginalRecordingContext({ projectId, session });
  const pending = tracks.filter(track => track.kind === 'temporary_stem');
  if (pending.length) {
    const roles = [...new Set(pending.map(track => track.replacementRoleName || track.originalName))].join(', ');
    throw Object.assign(new Error(`Approve replacement recordings for these temporary stems before the final mix or completion: ${roles}.`), { status: 409, code: 'ORIGINALS_TEMPORARY_STEMS_PENDING' });
  }
}
