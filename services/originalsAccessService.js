import { originalRecordingPlan } from './originalsRecordingPlanService.js';
import { getOriginalAgreement } from "./originalsAgreementService.js";
import { originalReviewStatus } from './originalsReviewService.js';
import { originalRoleManagement } from './originalsRoleManagementService.js';
import { originalTakeAssetIds } from "./originalsTakeFilesService.js";
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

export const originalReferenceKinds = new Set(['initial_stem', 'temporary_stem', 'guide_track', 'demo', 'voice_note', 'video_submission', 'click_track']);

export function presentOriginalWorkspace({ project, rounds, reservations, submissions, assets, notifications, invitations, creditVersions, issues, messages, futureReservations = [] }, user) {
  const viewerId = getOriginalsUserId(user);
  const canManage = canManageOriginalProject(project, user);
  const roleManagement = canManage ? originalRoleManagement({ project, rounds, reservations, submissions, futureReservations, invitations, assets }) : null;
  const chatAssetIds = sharedChatAssetIds(messages);
  const acceptedAssetIds = new Set(submissions.filter(item => item.state === 'accepted').flatMap(item => [String(item.outputAssetId || ''), ...originalTakeAssetIds(item.takes || []).map(String)]));
  const visibleSubmissions = canManage ? submissions : submissions.filter(item => String(item.musicianId) === viewerId || item.state === 'accepted');
  const visibleSubmissionIds = new Set(visibleSubmissions.filter(item => String(item.musicianId) === viewerId).map(item => String(item._id)));
  const visibleProject = { ...project, ownerName: originalOwnerDisplayName(project) };
  if (!canManage) {
    visibleProject.ownerEmail = '';
    delete visibleProject.ownerAgreement;
    delete visibleProject.ownerAgreementHistory;
    if (project.ownerAnonymous) visibleProject.ownerId = null;
  }
  return {
    roleProgress: originalRoleProgress({ project, rounds, reservations, submissions, futureReservations, viewerId }).map(role => ({ ...role, ...(roleManagement?.roles.find(rule => rule.name === role.name) || {}) })),
    ...(roleManagement ? { roleManagement: { canEdit: roleManagement.canEdit, reason: roleManagement.reason } } : {}),
    futureReservations: (canManage ? futureReservations : futureReservations.filter(item => String(item.musicianId) === viewerId)).map(item => ({ ...item, agreementNeedsReview: !item.agreementAcceptanceId || item.agreementVersion !== getOriginalAgreement().version || item.agreementTextHash !== getOriginalAgreement().textHash })),
    success: true, viewerId, permissions: { canManage, canIllustrateTscShare: String(user?.email || user?.useremail || '').trim().toLowerCase() === 'hello@thesupremecollective.co.uk' }, project: visibleProject, rounds,
    activeSlotCount: reservations.filter(item => String(item.roundId) === String(project.currentRoundId) && (item.state === 'active' && new Date(item.expiresAt) > new Date() || item.state === 'submitted') && item.slotHeld !== false && !submissions.some(sub => String(sub.reservationId) === String(item._id) && ['rejected','withdrawn','retracted'].includes(sub.state))).length,
    reservations: canManage ? reservations : reservations.filter(item => String(item.musicianId) === viewerId),
    submissions: visibleSubmissions.map(item => canManage || String(item.musicianId) === viewerId ? item : { ...item, previousVersions: [], revisionRequest: undefined, revisionSession: undefined }),
    ...(canManage ? { reviewStatus: originalReviewStatus(submissions), recordingPlan: originalRecordingPlan({ project, rounds, submissions }) } : {}),
    assets: canManage ? assets : assets.filter(item => item.state === 'active' && (String(item.ownerId) === viewerId || originalReferenceKinds.has(item.kind) || (project.initialAssetIds || []).some(id => String(id) === String(item._id)) || acceptedAssetIds.has(String(item._id)) || chatAssetIds.has(String(item._id)))),
    notifications: canManage ? notifications.filter(item => item.template !== 'originals_signed_agreement_copy') : [], invitations: canManage ? invitations : [],
    royaltyPreview: previewOriginalsSplits({ project, submissions }),
    creditVersions, issues: canManage ? issues : issues.filter(item => String(item.openedBy) === viewerId || visibleSubmissionIds.has(String(item.submissionId))), messages,
  };
}
