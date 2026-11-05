import Asset from '../models/originalAssetModel.js';
import Project from '../models/originalProjectModel.js';
import Message from '../models/originalMessageModel.js';
import Submission from '../models/originalSubmissionModel.js';
import { canManageOriginalProject, getOriginalsUserId } from './originalsPolicyService.js';
import { originalReferenceKinds } from './originalsAccessService.js';
export async function authoriseOriginalAsset(req) {
  const asset = await Asset.findById(req.params.assetId).lean();
  if (!asset || asset.state !== 'active') throw Object.assign(new Error('Asset not found'), { status: 404 });
  const project = await Project.findById(asset.projectId).lean();
  const visible = project && (canManageOriginalProject(project, req.user) || String(asset.ownerId) === getOriginalsUserId(req.user) || originalReferenceKinds.has(asset.kind) || (project.initialAssetIds || []).some(id => String(id) === String(asset._id)) || await Message.exists({ projectId: project._id, $or: [{ voiceAssetId: asset._id }, { attachmentIds: asset._id }] }) || await Submission.exists({ projectId: project._id, state: 'accepted', $or: [{ outputAssetId: asset._id }, { 'takes.stemAssetId': asset._id }, { 'takes.stemAssetIds': asset._id }, { 'takes.mixdownAssetId': asset._id }, { 'takes.wetStemAssetId': asset._id }] }));
  if (!visible) throw Object.assign(new Error('This file is private to its contributor and the project owner'), { status: 403 });
  return asset;
}
