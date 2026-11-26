import mongoose from 'mongoose';
import Asset from '../models/originalAssetModel.js';
import Project from '../models/originalProjectModel.js';
import Event from '../models/originalEventModel.js';
import { canModerateOriginals, getOriginalsUserId } from '../services/originalsPolicyService.js';

// Keep the stored recording for recovery and audit, but revoke project playback.
export async function removeOriginalGuide(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.assetId)) return res.status(400).json({ success: false, message: 'Invalid guide recording' });
  const userId = getOriginalsUserId(req.user);
  if (!userId) return res.status(401).json({ success: false, message: 'Sign in to manage guide recordings' });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const asset = await Asset.findById(req.params.assetId).session(session);
      if (!asset || asset.state !== 'active') throw Object.assign(new Error('Guide recording not found'), { status: 404 });
      const project = await Project.findById(asset.projectId).session(session);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      if (String(project.ownerId) !== userId && !canModerateOriginals(req.user)) throw Object.assign(new Error('Only the project owner or an administrator can remove guides'), { status: 403 });
      if (!['guide_track', 'demo', 'voice_note', 'video_submission'].includes(asset.kind) || asset.reservationId) throw Object.assign(new Error('Only project reference guides can be removed here'), { status: 409 });
      const removed = await Asset.updateOne({ _id: asset._id, state: 'active' }, { $set: { state: 'hidden' } }, { session });
      if (removed.matchedCount !== 1) throw Object.assign(new Error('This guide has changed. Refresh and try again.'), { status: 409 });
      await Project.updateOne({ _id: project._id }, { $pull: { initialAssetIds: asset._id } }, { session });
      await Event.create([{ projectId: project._id, actorId: userId, type: 'project_guide_removed', metadata: { assetId: String(asset._id), originalName: asset.originalName } }], { session });
    });
    return res.json({ success: true, assetId: req.params.assetId });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not remove the guide. Please try again.' });
  } finally { await session.endSession(); }
}
