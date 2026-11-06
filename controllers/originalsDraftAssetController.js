import mongoose from 'mongoose';
import { deleteOriginalDraftAsset } from '../services/originalsDraftAssetService.js';
import { getOriginalsUserId } from '../services/originalsPolicyService.js';

export async function deleteOriginalUploadedRecording(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.assetId)) return res.status(400).json({ success: false, message: 'Invalid uploaded recording' });
  const musicianId = getOriginalsUserId(req.user);
  if (!musicianId) return res.status(401).json({ success: false, message: 'Sign in to delete your recording' });
  try {
    await deleteOriginalDraftAsset({ assetId: req.params.assetId, musicianId });
    return res.json({ success: true, assetId: req.params.assetId });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not delete the uploaded recording. Please try again.' });
  }
}
