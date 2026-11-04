import { originalRoleProgress } from "./originalsRoleProgressService.js";
import { sharedChatAssetIds } from "./originalsChatService.js";
import { previewOriginalsSplits } from "./originalsRoyaltyService.js";
import originalProjectModel from '../models/originalProjectModel.js';
import { canManageOriginalProject, getOriginalsUserId, originalOwnerDisplayName } from './originalsPolicyService.js';

export async function requireOriginalProjectManager(req, res, projectId) {
  const project = await originalProjectModel.findById(projectId).lean();
  if (!project) { res.status(404).json({ success: false, message: 'Originals project not found' }); return null; }
  if (!canManageOriginalProject(project, req.user)) { res.status(403).json({ success: false, message: 'Only the project owner or TSC can manage this project' }); return null; }
  return project;
}

export const originalReferenceKinds = new Set(['initial_stem', 'guide_track', 'demo', 'video_submission', 'click_track']);

export function presentOriginalWorkspace({ project, rounds, reservations, submissions, assets, notifications, invitations, creditVersions, issues, messages }, user) {
  const viewerId = getOriginalsUserId(user);
  const canManage = canManageOriginalProject(project, user);
  const chatAssetIds = sharedChatAssetIds(messages);
  const acceptedAssetIds = new Set(submissions.filter(item => item.state === 'accepted').flatMap(item => [String(item.outputAssetId || ''), ...(item.takes || []).flatMap(take => [String(take.stemAssetId), String(take.mixdownAssetId), String(take.wetStemAssetId || "")])]));
  const visibleSubmissions = canManage ? submissions : submissions.filter(item => String(item.musicianId) === viewerId || item.state === 'accepted');
  const visibleSubmissionIds = new Set(visibleSubmissions.filter(item => String(item.musicianId) === viewerId).map(item => String(item._id)));
  const visibleProject = { ...project, ownerName: originalOwnerDisplayName(project) };
  if (!canManage) {
    visibleProject.ownerEmail = '';
    if (project.ownerAnonymous) visibleProject.ownerId = null;
  }
  return {
    roleProgress: originalRoleProgress({ project, rounds, reservations, submissions }),
    success: true, viewerId, permissions: { canManage }, project: visibleProject, rounds,
    activeSlotCount: reservations.filter(item => String(item.roundId) === String(project.currentRoundId) && item.state === 'active' && new Date(item.expiresAt) > new Date()).length,
    reservations: canManage ? reservations : reservations.filter(item => String(item.musicianId) === viewerId),
    submissions: visibleSubmissions,
    assets: canManage ? assets : assets.filter(item => item.state === 'active' && (String(item.ownerId) === viewerId || originalReferenceKinds.has(item.kind) || (project.initialAssetIds || []).some(id => String(id) === String(item._id)) || acceptedAssetIds.has(String(item._id)) || chatAssetIds.has(String(item._id)))),
    notifications: canManage ? notifications : [], invitations: canManage ? invitations : [],
    royaltyPreview: previewOriginalsSplits({ project, submissions }),
    creditVersions, issues: canManage ? issues : issues.filter(item => String(item.openedBy) === viewerId || visibleSubmissionIds.has(String(item.submissionId))), messages,
  };
}
