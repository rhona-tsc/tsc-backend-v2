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

const router = express.Router();

// Twilio inbound & status webhooks
router.post('/twilio/inbound', express.urlencoded({ extended: false }), twilioInbound);
router.post('/twilio/status',  express.urlencoded({ extended: false }), twilioStatus);

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

// Manual rebuild endpoints
router.post('/rebuild-availability-badge', rebuildAvailabilityBadge);
router.post('/badges/rebuild', rebuildAndApplyBadge); // data-driven version
router.get('/resolve-musician', resolveAvailableMusician);

export default router;