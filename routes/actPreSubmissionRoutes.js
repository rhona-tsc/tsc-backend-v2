import express from "express";
import {
  submitActPreSubmission,
  getPendingActPreSubmissions,
  approveActPreSubmission,
  rejectActPreSubmission,
  validateActInviteCode,
  markInviteCodeUsed,
  getActPreSubmissionCount
} from "../controllers/actPreSubmissionController.js";

const router = express.Router();

// musician submits
router.post("/submit", submitActPreSubmission);

// agent view
router.get("/pending", getPendingActPreSubmissions);
router.get("/pending-count", getActPreSubmissionCount);

// approval flow
router.post("/approve/:id", approveActPreSubmission);
router.post("/reject/:id", rejectActPreSubmission);

// validation
router.post("/validate-code", validateActInviteCode);
router.post("/mark-used", markInviteCodeUsed);

export default router;