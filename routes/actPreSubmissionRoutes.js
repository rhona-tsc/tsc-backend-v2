// routes/actPreSubmissionRoutes.js
import express from "express";
import {
  submitActPreSubmission,
  getPendingActPreSubmissions,
  approveActPreSubmission,
  rejectActPreSubmission,
  validateActInviteCode,
  markInviteCodeUsed,
  getActPreSubmissionCount,
  getOnePreSubmission,

  // ✅ add these:
  previewActPreSubmissionApproval,
  resendActPreSubmissionApproval,
} from "../controllers/actPreSubmissionController.js";
import requireAdminDashboard from "../middleware/requireAdminDashboard.js";

const router = express.Router();

// musician submits
router.post("/submit", submitActPreSubmission);

// agent view
router.get("/pending", requireAdminDashboard, getPendingActPreSubmissions);
router.get("/pending-count", getActPreSubmissionCount);
router.get("/:id", requireAdminDashboard, getOnePreSubmission);

// approval flow (✅ protect)
router.post("/approve/:id", requireAdminDashboard, approveActPreSubmission);
router.post("/reject/:id", requireAdminDashboard, rejectActPreSubmission);

// ✅ NEW: preview + resend
router.post("/approve-preview/:id", requireAdminDashboard, previewActPreSubmissionApproval);
router.post("/approve-resend/:id", requireAdminDashboard, resendActPreSubmissionApproval);

// validation (musician use — leave open or require auth as you prefer)
router.post("/validate-code", validateActInviteCode);
router.post("/mark-used", markInviteCodeUsed);

export default router;