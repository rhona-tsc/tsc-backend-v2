import express from "express";
import agentAuth from "../middleware/agentAuth.js";
import {
  getSeoKeywordTracker,
  completeSeoGoogleOAuth,
  refreshSeoKeywordTracker,
  runSeoKeywordCron,
  sendSeoKeywordTestEmail,
  startSeoGoogleOAuth,
  updateSeoKeywordTracker,
} from "../controllers/seoKeywordController.js";

const router = express.Router();

const cronAuth = (req, res, next) => {
  const expected = process.env.CRON_SECRET;
  const received = req.headers["x-cron-secret"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || received !== expected) {
    return res.status(401).json({ success: false, message: "Invalid cron secret" });
  }
  return next();
};

router.post("/run-monthly", cronAuth, runSeoKeywordCron);
router.get("/google/callback", completeSeoGoogleOAuth);
router.use(agentAuth);
router.get("/google/start", startSeoGoogleOAuth);
router.get("/", getSeoKeywordTracker);
router.put("/", updateSeoKeywordTracker);
router.post("/refresh", refreshSeoKeywordTracker);
router.post("/send-test", sendSeoKeywordTestEmail);

export default router;
