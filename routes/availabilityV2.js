// backend/routes/availabilityV2.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import { triggerAvailabilityRequest } from "../controllers/availabilityController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 💖 AVAILABILITY V2 ROUTES WITH ROUTE-LEVEL LOGGING                         */
/* -------------------------------------------------------------------------- */

// Trigger new availability request
router.post("/request", (req, res, next) => {
  console.log('💖 (routes/availabilityV2) /request triggered at', new Date().toISOString(), {
    body: req.body,
  });
  next();
}, triggerAvailabilityRequest);

// Cancel active conversation lock
router.post("/cancel-active", async (req, res) => {
  console.log('💖 (routes/availabilityV2) /cancel-active triggered at', new Date().toISOString(), {
    body: req.body,
  });

  const phone = req.body?.phone;
  if (!phone) return res.status(400).json({ success: false, message: "phone required" });

  await ConversationLock.deleteOne({ phone });
  await releaseLockAndProcessNext(phone);
  res.json({ success: true });
});

// Check for duplicate availability requests
router.post("/check-duplicate", async (req, res) => {
  console.log('💖 (routes/availabilityV2) /check-duplicate triggered at', new Date().toISOString(), {
    body: req.body,
  });

  const { actId, date, address } = req.body;
  if (!actId || !date || !address) {
    return res.status(400).json({ success: false, message: "Missing actId/date/address" });
  }

  const exists = await AvailabilityModel.findOne({
    actId,
    dateISO: date,
    formattedAddress: address,
  });

  if (exists) {
    return res.json({ success: false, message: "Availability already triggered" });
  }

  res.json({ success: true });
});

export default router;