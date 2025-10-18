// backend/routes/allocationRoutes.js
import express from "express";
import { triggerBookingRequests, twilioInboundBooking } from "../controllers/allocationController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                              ROUTE: /trigger                               */
/* -------------------------------------------------------------------------- */
router.post("/trigger", (req, res, next) => {
  console.log(`💌 (routes/allocationRoutes.js) POST /api/booking/trigger called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, triggerBookingRequests);

/* -------------------------------------------------------------------------- */
/*                         ROUTE: /twilio/inbound                             */
/* -------------------------------------------------------------------------- */
router.post("/twilio/inbound", (req, res, next) => {
  console.log(`💌 (routes/allocationRoutes.js) POST /api/booking/twilio/inbound called at`, new Date().toISOString(), {
    from: req.body?.From || req.body?.WaId,
    bodySnippet: String(req.body?.Body || "").slice(0, 100),
  });
  next();
}, twilioInboundBooking);

export default router;