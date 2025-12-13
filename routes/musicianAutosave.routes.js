import express from "express";
import { autosaveMusicianForm, listAutosaveHistory } from "../controllers/musicianAutosave.controller.js";
import authMiddleware from "../middleware/auth.js"; // use whatever you already use

const router = express.Router();

router.post("/autosave", authMiddleware, autosaveMusicianForm);
router.get("/autosave/history/:musicianId", authMiddleware, listAutosaveHistory);

export default router;