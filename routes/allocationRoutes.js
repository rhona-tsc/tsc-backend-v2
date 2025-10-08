import express from "express";
import { triggerBookingRequests, twilioInboundBooking } from "../controllers/allocationController.js";

const router = express.Router();

router.post("/trigger", triggerBookingRequests);        // POST /api/booking/trigger
router.post("/twilio/inbound", twilioInboundBooking);   // POST /api/booking/twilio/inbound

export default router;