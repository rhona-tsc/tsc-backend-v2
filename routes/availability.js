// routes/availability.js
import express from 'express';
import AvailabilityModel from '../models/availabilityModel.js';
import { rebuildAvailabilityBadge, resolveAvailableMusician, twilioStatus, twilioInbound } from '../controllers/availabilityController.js';

const router = express.Router();

// Twilio webhooks (production & sandbox)
router.post('/twilio/inbound', express.urlencoded({ extended: false }), twilioInbound);
router.post('/twilio/status',  express.urlencoded({ extended: false }), twilioStatus);

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
    res.status(500).json({ latestReply: null });
  }
});

router.post('/rebuild-badge', rebuildAvailabilityBadge);
router.get('/resolve-musician', resolveAvailableMusician);

export default router;