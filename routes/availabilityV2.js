// backend/routes/availabilityV2.js
import express from "express";
import {  twilioInboundV2, twilioStatusV2 } from "../controllers/availabilityControllerV2.js";
import { shortlistActAndTriggerAvailability } from "../controllers/shortlistController.js";
import AvailabilityModel from "../models/availabilityModel.js";

const router = express.Router();

router.post("/request", shortlistActAndTriggerAvailability);

router.post("/cancel-active", async (req, res) => {
  const phone = req.body?.phone;
  if (!phone) return res.status(400).json({ success:false, message:"phone required" });
  await ConversationLock.deleteOne({ phone });
  await releaseLockAndProcessNext(phone);
  res.json({ success:true });
});


router.post("/check-duplicate", async (req, res) => {
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