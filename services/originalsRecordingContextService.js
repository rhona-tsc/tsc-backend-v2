import { createHash } from 'node:crypto';
import Project from '../models/originalProjectModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Asset from '../models/originalAssetModel.js';

const id = value => String(value?._id || value || '');
const roleKey = value => String(value || '').trim().toLowerCase();
const read = (query, session) => (session ? query.session(session) : query).lean();
export function originalRecordingContext({ project, submissions = [], assets = [], excludeId = '' }) {
  const available = new Map(assets.filter(asset => asset.state === 'active' && id(asset._id) !== id(excludeId)).map(asset => [id(asset._id), asset]));
  const layers = new Map();
  for (const asset of available.values()) if (asset.kind === 'temporary_stem') layers.set(id(asset._id), { ...asset, label: `${asset.replacementRoleName || 'Starting part'} — temporary` });
  for (const asset of available.values()) if (asset.kind === 'initial_stem' && asset.finalEligible !== false) layers.set(id(asset._id), { ...asset });
  const replacedRoles = new Set();
  for (const submission of submissions) {
    if (submission.state !== 'accepted' || (submission.category && submission.category !== 'contribution')) continue;
    for (const take of submission.takes || []) {
      const whole = submission.selectionMode === 'whole_take' && id(take._id) === id(submission.selectedTakeId);
      const ranges = submission.selectionMode === 'selected_ranges' ? (submission.selectedRanges || []).filter(range => id(range.takeId) === id(take._id) && Number.isFinite(range.startSeconds) && Number.isFinite(range.endSeconds) && range.startSeconds >= 0 && range.endSeconds > range.startSeconds).map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })) : [];
      if (!whole && !ranges.length) continue;
      for (const stemId of take.stemAssetIds?.length ? take.stemAssetIds : [take.stemAssetId]) {
        const asset = available.get(id(stemId));
        if (!asset || asset.kind !== 'take_stem' || asset.finalEligible === false) continue;
        replacedRoles.add(roleKey(submission.roleName));
        const previous = layers.get(id(stemId));
        if (previous && !previous.playbackRanges) continue;
        layers.set(id(stemId), { ...asset, label: submission.roleName, ...(!whole ? { playbackRanges: [...(previous?.playbackRanges || []), ...ranges] } : {}) });
      }
    }
  }
  const references = [...layers.values()].filter(asset => asset.kind !== 'temporary_stem' || !replacedRoles.has(roleKey(asset.replacementRoleName)));
  if (!references.length) {
    const guides = [...available.values()].filter(asset => asset.kind === 'guide_track' && asset.mimeType?.startsWith('audio/'));
    const demos = [...available.values()].filter(asset => asset.kind === 'demo' && asset.mimeType?.startsWith('audio/'));
    const guide = (guides.length ? guides : demos).sort((a, b) => (new Date(a.createdAt || 0) - new Date(b.createdAt || 0)) || id(a._id).localeCompare(id(b._id))).at(-1);
    if (guide) references.push(guide);
  }
  references.push(...[...available.values()].filter(asset => asset.kind === 'click_track'));
  const tracks = [...new Map(references.map(asset => [id(asset._id), asset])).values()].sort((a, b) => id(a._id).localeCompare(id(b._id)));
  const contextKey = createHash('sha256').update(JSON.stringify({ projectId: id(project._id), tracks: tracks.map(track => ({ id: id(track._id), ranges: track.playbackRanges ? [...track.playbackRanges].sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds) : null })) })).digest('hex');
  return { contextKey, tracks };
}
export async function loadOriginalRecordingContext({ projectId, excludeId, session }) {
  const project = await read(Project.findById(projectId), session);
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  const submissions = await read(Submission.find({ projectId, state: 'accepted' }).select('state category roleName takes selectionMode selectedTakeId selectedRanges'), session);
  const assets = await read(Asset.find({ projectId, state: 'active', kind: { $in: ['initial_stem', 'temporary_stem', 'take_stem', 'guide_track', 'demo', 'click_track'] } }).select('kind originalName mimeType state finalEligible replacementRoleName createdAt'), session);
  return originalRecordingContext({ project, submissions, assets, excludeId });
}
export async function requireOriginalStemReviews({ assets, musicianId }) {
  const stems = assets.filter(asset => asset.kind === 'take_stem' && asset.alignmentReviewRequired);
  // Confirm each immutable uploaded file once. Later project approvals do not
  // erase that confirmation; a replacement upload has its own unreviewed ID.
  for (const asset of stems) {
    if (!asset.alignmentReview?.reviewedAt || id(asset.alignmentReview?.reviewedBy) !== id(musicianId)) throw Object.assign(new Error('Listen to this stem with the project tracks and confirm its alignment before submitting.'), { status: 409, code: 'ORIGINALS_ALIGNMENT_REVIEW_REQUIRED', assetId: id(asset._id) });
  }
}
