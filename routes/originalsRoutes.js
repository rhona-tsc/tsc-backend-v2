import { allowOriginalInvitationRequest } from "../services/originalsInvitationAccessService.js";
import { getOriginalStemPreview, confirmOriginalStemReview, streamOriginalAudio } from '../controllers/originalsRecordingController.js';
import { changeOriginalProjectRole } from '../controllers/originalsRolesController.js';
import { getOriginalReviewStatus } from '../controllers/originalsReviewController.js';
import { getOriginalChatUnread, readOriginalChat } from '../controllers/originalsChatReadController.js';
import { getOriginalReservationAgreements, renewFutureOriginalAgreement, reserveFutureOriginalRole, releaseFutureOriginalRole, releaseOriginalReservation } from "../controllers/originalsReservationsController.js";
import { allowOriginalReferralRequest } from "../services/originalsReferralService.js";
import { searchOriginalReferralMusicians, recommendOriginalMusician, claimOriginalReferral } from "../controllers/originalsReferralController.js";
import { requireOriginalParticipation } from "../services/originalsMembershipService.js";
import OriginalAsset from "../models/originalAssetModel.js";
import OriginalIssue from "../models/originalIssueModel.js";
import OriginalCredit from "../models/originalCreditVersionModel.js";
import express from "express";
import multer from "multer";
import authUser from "../middleware/auth.js";
import {
  createOriginalProject,
  getOriginalOwnerAgreementTerms,
  decideOriginalProjectModeration,
  listMyOriginalProjects,
  listOriginalProjects,
  listOriginalsModeration,
  resendOriginalProjectLaunchNotifications,
  submitOriginalProjectForModeration,
  updateOriginalProject,
} from "../controllers/originalsController.js";
import {
  accessOriginalAsset,
  decideReservationExtension,
  decideOriginalSubmission,
  getOriginalProjectWorkspace,
  inviteOriginalMusician,
  openNextOriginalRound,
  openOriginalIssue,
  postOriginalMessage,
  getOriginalMessages,
  requestReservationExtension,
  reserveOriginalRound,
  reopenOriginalRound,
  replaceOriginalSubmission,
  searchOriginalMusicians,
  submitOriginalTakes,
  submitOriginalProduction,
  updateOriginalIssue,
  uploadOriginalAsset,
} from "../controllers/originalsWorkflowController.js";
import { canAccessOriginalsPreview, isOriginalsEnabled } from "../services/originalsPolicyService.js";
import {
  completeOriginalProject,
  confirmOriginalCreditVersion,
  createOriginalCreditVersion,
  finaliseOriginalCreditsAsAdmin,
  getOriginalsMusicianStats,
  getOriginalsReadiness,
} from "../controllers/originalsCreditsController.js";

const router = express.Router();

router.use(authUser);
router.use(async (req, res, next) => {
  if (canAccessOriginalsPreview(req.user)) return next();
  try { if (await allowOriginalReferralRequest(req) || await allowOriginalInvitationRequest(req)) return next(); }
  catch { return res.status(400).json({ success: false, message: "Could not check project invitation" }); }
  if (!isOriginalsEnabled()) {
    return res.status(503).json({
      success: false,
      code: "ORIGINALS_DISABLED",
      message: "TSC Originals is not available yet",
    });
  }
  if (/\/referrals\/claim\/?$/.test(req.path)) return res.status(403).json({ success: false, message: "Use the account this invitation was emailed to, or check that the invitation link is still valid." });
  return res.status(403).json({
    success: false,
    code: "ORIGINALS_PRIVATE_PREVIEW",
    message: "TSC Originals is currently in a private admin preview",
  });
});

// Check participation before any project data, file, or workflow action is reached.
router.use('/projects/:id', requireOriginalParticipation);
router.use('/rounds/:roundId', requireOriginalParticipation);
router.use('/reservations/:reservationId', requireOriginalParticipation);
router.use('/submissions/:submissionId', requireOriginalParticipation);
for (const [path, param, Model] of [
  ['/assets/:assetId', 'assetId', OriginalAsset],
  ['/issues/:issueId', 'issueId', OriginalIssue],
  ['/credit-versions/:versionId', 'versionId', OriginalCredit],
]) {
  router.use(path, async (req, res, next) => {
    try {
      const resource = await Model.findById(req.params[param]).select('projectId').lean();
      if (!resource) return res.status(404).json({ success: false, message: 'Project item not found' });
      req.originalProjectId = resource.projectId;
      return requireOriginalParticipation(req, res, next);
    } catch { return res.status(400).json({ success: false, message: 'Invalid project item' }); }
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

router.get("/owner-agreement", getOriginalOwnerAgreementTerms);
router.get("/projects", listOriginalProjects);
router.get("/mine", listMyOriginalProjects);
router.post("/projects", createOriginalProject);
router.patch("/projects/:id", updateOriginalProject);
router.post("/projects/:id/roles", changeOriginalProjectRole);
router.post("/projects/:id/submit-for-moderation", submitOriginalProjectForModeration);
router.get("/projects/:id/access", (_req, res) => { res.set("Cache-Control", "no-store"); res.json({ success: true }); });
router.get("/projects/:id/musicians", searchOriginalReferralMusicians);
router.post("/projects/:id/referrals", recommendOriginalMusician);
router.post("/projects/:id/referrals/claim", claimOriginalReferral);
router.get("/projects/:id/reservation-agreements", getOriginalReservationAgreements);
router.post("/projects/:id/role-reservations/:futureId/agreement", renewFutureOriginalAgreement);
router.post("/projects/:id/role-reservations", reserveFutureOriginalRole);
router.post("/projects/:id/role-reservations/:futureId/release", releaseFutureOriginalRole);
router.post("/reservations/:reservationId/release", releaseOriginalReservation);
router.get("/projects/:id/workspace", getOriginalProjectWorkspace);
router.get("/projects/:id/review-status", getOriginalReviewStatus);
router.post("/projects/:id/assets", upload.single("file"), uploadOriginalAsset);
router.get("/assets/:assetId/access", accessOriginalAsset);
router.get('/assets/:assetId/audio', streamOriginalAudio);
router.get('/assets/:assetId/recording-preview', getOriginalStemPreview);
router.post('/assets/:assetId/alignment-review', confirmOriginalStemReview);
router.post("/rounds/:roundId/reservations", reserveOriginalRound);
router.post("/reservations/:reservationId/request-extension", requestReservationExtension);
router.post("/reservations/:reservationId/grant-extension", decideReservationExtension);
router.post("/reservations/:reservationId/submissions", submitOriginalTakes);
router.post("/submissions/:submissionId/decision", decideOriginalSubmission);
router.post("/rounds/:roundId/reopen", reopenOriginalRound);
router.post("/projects/:id/rounds", openNextOriginalRound);
router.post("/rounds/:roundId/invitations", inviteOriginalMusician);
router.get("/musicians/search", searchOriginalMusicians);
router.post("/reservations/:reservationId/production-submissions", submitOriginalProduction);
router.post("/projects/:id/credits", createOriginalCreditVersion);
router.post("/credit-versions/:versionId/confirm", confirmOriginalCreditVersion);
router.post("/credit-versions/:versionId/finalise", finaliseOriginalCreditsAsAdmin);
router.post("/projects/:id/complete", completeOriginalProject);
router.get("/projects/:id/messages/unread", getOriginalChatUnread);
router.post("/projects/:id/messages/read", readOriginalChat);
router.get("/projects/:id/messages", getOriginalMessages);
router.post("/projects/:id/messages", postOriginalMessage);
router.post("/submissions/:submissionId/replace", replaceOriginalSubmission);
router.post("/submissions/:submissionId/issues", openOriginalIssue);
router.post("/issues/:issueId", updateOriginalIssue);
router.get("/readiness", getOriginalsReadiness);
router.get("/musicians/:musicianId/stats", getOriginalsMusicianStats);

router.get("/moderation", listOriginalsModeration);
router.post("/projects/:id/moderate", decideOriginalProjectModeration);
router.post("/projects/:id/notify-launch", resendOriginalProjectLaunchNotifications);

export default router;
