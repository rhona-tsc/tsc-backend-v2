import express from "express";
import {
  approvePendingChanges,
  rejectPendingChanges,
  savePendingChanges
} from "../controllers/ActModerationController.js";

import {
  saveActDraftV2,
  createActV2,
  getActByIdV2,
  updateActV2,
  getAllActsV2,
  getMyDrafts,
  getModerationCount,
  trashAct,
  getTrashedActs,
  restoreAct,
  deleteActPermanently
} from "../controllers/actV2Controller.js";
import { updateActStatus } from "../controllers/actV2Controller.js";



const router = express.Router();

router.post("/save-draft", saveActDraftV2);
router.post("/create", createActV2);
router.post("/trash", trashAct);
router.get("/trashed", getTrashedActs);
router.delete('/delete-permanent', deleteActPermanently);
router.post("/restore", restoreAct);
router.get("/list", getAllActsV2);
router.get("/:id", getActByIdV2);      
router.put("/update/:id", updateActV2);
router.post("/security-update/:id", updateActV2); // same as update but for security
router.get('/my-drafts', getMyDrafts);
router.put("/save-pending-changes/:id", savePendingChanges);
router.put("/approve-pending-changes/:id", approvePendingChanges);
router.put("/reject-pending-changes/:id", rejectPendingChanges);
router.get("/moderation-count", getModerationCount);
router.post("/update-status", updateActStatus);

export default router;
