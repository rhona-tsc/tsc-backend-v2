// routes/availability.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import { resolveAvailableMusician, rebuildAndApplyBadge, handleLeadNegativeReply, twilioInbound } from "../controllers/availabilityController.js";
import { applyFeaturedBadgeOnYesV3 } from "../controllers/applyFeaturedBadgeOnYesV2.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { buildBadgeFromAvailability } from "../controllers/availabilityBadgeController.js";
import Act from "../models/actModel.js";
import { notifyDeputyOneShot } from "../controllers/availabilityHelpers.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                            GET /check-latest                               */
/* -------------------------------------------------------------------------- */
router.get("/check-latest", async (req, res) => {
  console.log(`🟢 (routes/availability.js) /check-latest route START at ${new Date().toISOString()}`, {
    actId: req.query?.actId,
    dateISO: req.query?.dateISO,
  });
  try {
    const { actId, dateISO } = req.query;
    if (!actId || !dateISO) return res.status(400).json({ latestReply: null });

    const doc = await AvailabilityModel.findOne({ actId, dateISO })
      .sort({ repliedAt: -1, updatedAt: -1, createdAt: -1 });

    const latestReply =
      doc?.reply ||
      (["declined", "cancelled"].includes(doc?.calendarStatus) ? "unavailable" : null);

    res.json({ latestReply: latestReply || null });
  } catch (e) {
    console.error("⚠️ check-latest error:", e.message);
    res.status(500).json({ latestReply: null });
  }
});

/* -------------------------------------------------------------------------- */
/*                          POST /twilio/inbound                              */
/* -------------------------------------------------------------------------- */



// ✅ routes/availability.js
router.post("/twilio/inbound", twilioInbound);

/* -------------------------------------------------------------------------- */
/*                  POST /rebuild-availability-badge                          */
/* -------------------------------------------------------------------------- */
router.post("/rebuild-availability-badge", (req, res, next) => {
  console.log(`🟢 (routes/availability.js) /rebuild-availability-badge route START at ${new Date().toISOString()}`, {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, applyFeaturedBadgeOnYesV3);

/* -------------------------------------------------------------------------- */
/*                       POST /badges/rebuild                                 */
/* -------------------------------------------------------------------------- */
router.post("/badges/rebuild", (req, res, next) => {
  console.log(`🟢 (routes/availability.js) /badges/rebuild route START at ${new Date().toISOString()}`, {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, rebuildAndApplyBadge);

/* -------------------------------------------------------------------------- */
/*                        GET /resolve-musician                               */
/* -------------------------------------------------------------------------- */
router.get("/resolve-musician", (req, res, next) => {
  console.log(`🟢 (routes/availability.js) /resolve-musician route START at ${new Date().toISOString()}`, {
    query: req.query,
  });
  next();
}, resolveAvailableMusician);

export default router;