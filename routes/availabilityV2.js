// backend/routes/availabilityV2.js
import express from "express";
import { triggerLeadAvailabilityV2, twilioInboundV2, twilioStatusV2 } from "../controllers/availabilityControllerV2.js";

const router = express.Router();

router.post("/request", triggerLeadAvailabilityV2);

router.post("/cancel-active", async (req, res) => {
  const phone = req.body?.phone;
  if (!phone) return res.status(400).json({ success:false, message:"phone required" });
  await ConversationLock.deleteOne({ phone });
  await releaseLockAndProcessNext(phone);
  res.json({ success:true });
});

// Webhooks for this V2 path (keep separate from V1 so it’s not tangled)
router.post("/twilio/inbound",  express.urlencoded({ extended: false }), twilioInboundV2);
router.post("/twilio/status",   express.urlencoded({ extended: false }), twilioStatusV2);

export default router;