// routes/availability.js
import express from 'express';
import AvailabilityModel from '../models/availabilityModel.js';
import {
  rebuildAvailabilityBadge,
  resolveAvailableMusician,
  twilioStatus,
  twilioInbound,
  rebuildAndApplyBadge
} from '../controllers/availabilityController.js';
import { applyFeaturedBadgeOnYesV3 } from '../controllers/applyFeaturedBadgeOnYesV2.js';
import { findPersonByPhone } from '../utils/findPersonByPhone.js';

const router = express.Router();

// Quick latest-reply check
router.get('/check-latest', async (req, res) => {
  try {
    const { actId, dateISO } = req.query;
    if (!actId || !dateISO) return res.status(400).json({ latestReply: null });

    const doc = await AvailabilityModel.findOne({ actId, dateISO })
      .sort({ repliedAt: -1, updatedAt: -1, createdAt: -1 });

    const latestReply =
      doc?.reply ||
      (['declined', 'cancelled'].includes(doc?.calendarStatus) ? 'unavailable' : null);

    res.json({ latestReply: latestReply || null });
  } catch (e) {
    console.error("⚠️ check-latest error:", e.message);
    res.status(500).json({ latestReply: null });
  }
});

router.post("/twilio/inbound", async (req, res) => {
  try {
    const { From, Body, ButtonText, ButtonPayload } = req.body;

    const fromPhone = From?.replace(/^whatsapp:/i, "").trim();

    console.log("📩 Twilio inbound webhook:", {
      From: fromPhone,
      Body,
      ButtonText,
      ButtonPayload,
    });

    // 🔍 Lookup musician by phone (direct DB lookup)
    const musician = await findPersonByPhone(fromPhone);

    if (musician) {
      console.log("✅ Matched musician:", musician.firstName, musician.lastName);
      // continue handling reply logic...
    } else {
      console.warn("❌ No musician found for", fromPhone);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Twilio inbound error:", err);
    res.sendStatus(500);
  }
});

// Manual rebuild endpoints
router.post('/rebuild-availability-badge', applyFeaturedBadgeOnYesV3);
router.post('/badges/rebuild', rebuildAndApplyBadge); // data-driven version
router.get('/resolve-musician', resolveAvailableMusician);

export default router;