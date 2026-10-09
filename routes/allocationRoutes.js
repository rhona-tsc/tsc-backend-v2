// backend/routes/allocationRoutes.js
import express from "express";
import { triggerBookingRequests, twilioInboundBooking, listRoleCandidates, offerBookingRole, confirmBookingRole, withdrawMyBooking } from "../controllers/allocationController.js";
import musicianAuth from "../middleware/musicianAuth.js";

const router = express.Router();

router.get("/role-candidates", musicianAuth, listRoleCandidates);
router.post("/offer-role", musicianAuth, offerBookingRole);
router.post("/confirm-role", musicianAuth, confirmBookingRole);
router.post("/bookings/:id/withdraw", musicianAuth, withdrawMyBooking);

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
