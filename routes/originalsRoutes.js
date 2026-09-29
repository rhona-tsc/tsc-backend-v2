import express from "express";
import multer from "multer";
import authUser from "../middleware/auth.js";
import {
  createOriginalProject,
  decideOriginalProjectModeration,
  listMyOriginalProjects,
  listOriginalProjects,
  listOriginalsModeration,
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
  requestReservationExtension,
  reserveOriginalRound,
  reopenOriginalRound,
  searchOriginalMusicians,
  submitOriginalTakes,
  submitOriginalProduction,
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

router.use((req, res, next) => {
  if (isOriginalsEnabled()) return next();
  return res.status(503).json({
    success: false,
    code: "ORIGINALS_DISABLED",
    message: "TSC Originals is not available yet",
  });
});

router.use(authUser);
router.use((req, res, next) => {
  if (canAccessOriginalsPreview(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: "ORIGINALS_PRIVATE_PREVIEW",
    message: "TSC Originals is currently in a private admin preview",
  });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

router.get("/projects", listOriginalProjects);
router.get("/mine", listMyOriginalProjects);
router.post("/projects", createOriginalProject);
router.patch("/projects/:id", updateOriginalProject);
router.post("/projects/:id/submit-for-moderation", submitOriginalProjectForModeration);
router.get("/projects/:id/workspace", getOriginalProjectWorkspace);
router.post("/projects/:id/assets", upload.single("file"), uploadOriginalAsset);
router.get("/assets/:assetId/access", accessOriginalAsset);
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
router.get("/readiness", getOriginalsReadiness);
router.get("/musicians/:musicianId/stats", getOriginalsMusicianStats);

router.get("/moderation", listOriginalsModeration);
router.post("/projects/:id/moderate", decideOriginalProjectModeration);

export default router;
