// routes/availability.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import { resolveAvailableMusician, rebuildAndApplyBadge } from "../controllers/availabilityController.js";
import { applyFeaturedBadgeOnYesV3 } from "../controllers/applyFeaturedBadgeOnYesV2.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";

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
router.post("/twilio/inbound", async (req, res) => {
  console.log(`🟢 (routes/availability.js) /twilio/inbound route START at ${new Date().toISOString()}`, {
    From: req.body?.From,
    Body: req.body?.Body,
    ButtonText: req.body?.ButtonText,
    ButtonPayload: req.body?.ButtonPayload,
  });

  try {
    const { From, Body, ButtonText, ButtonPayload } = req.body;
    const fromPhone = From?.replace(/^whatsapp:/i, "").trim();

    console.log("📩 Twilio inbound webhook:", {
      From: fromPhone,
      Body,
      ButtonText,
      ButtonPayload,
    });

    // 🔍 Lookup musician by phone
    const musician = await findPersonByPhone(fromPhone);

    if (musician) {
      console.log("✅ Matched musician:", musician.firstName, musician.lastName);
    } else {
      console.warn("❌ No musician found for", fromPhone);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Twilio inbound error:", err);
    res.sendStatus(500);
  }
});

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