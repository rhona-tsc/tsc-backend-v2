// routes/debug.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";

const router = express.Router();

// GET /api/debug/calendar-status?status=declined&minutes=1440
router.get("/calendar-status", async (req, res) => {
  try {
    const { status, minutes = 1440 } = req.query;
    const since = new Date(Date.now() - Number(minutes) * 60 * 1000);

    const query = {
      updatedAt: { $gte: since },
      calendarEventId: { $exists: true, $ne: null },
    };
    if (status) query.calendarStatus = status;

    const docs = await AvailabilityModel.find(query)
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    res.json({ count: docs.length, since, status: status || "(any)", docs });
  } catch (e) {
    console.error("debug calendar-status error", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;