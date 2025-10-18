// routes/bookingRoutes.js
import express from "express";
import verifyToken from "../middleware/agentAuth.js";
import {
  createCheckoutSession,
  completeBooking,
  manualCreateBooking,
  markMusicianAsPaid,
  getBookingByRef,
  updateEventSheet,
  ensureEmergencyContact,
  completeBookingV2
} from "../controllers/bookingController.js";
import Booking from "../models/bookingModel.js";
import mongoose from "mongoose";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*              POST /:id/ensure-emergency-contact                            */
/* -------------------------------------------------------------------------- */
router.post("/:id/ensure-emergency-contact", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/:id/ensure-emergency-contact called at`, new Date().toISOString(), {
    id: req.params?.id,
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, ensureEmergencyContact);

/* -------------------------------------------------------------------------- */
/*              POST /create-checkout-session                                 */
/* -------------------------------------------------------------------------- */
router.post("/create-checkout-session", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/create-checkout-session called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, createCheckoutSession);

/* -------------------------------------------------------------------------- */
/*              GET /booking-complete                                         */
/* -------------------------------------------------------------------------- */
router.get("/booking-complete", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/booking-complete called at`, new Date().toISOString(), {
    query: req.query,
  });
  next();
}, completeBookingV2);

/* -------------------------------------------------------------------------- */
/*              GET /user/:userId                                             */
/* -------------------------------------------------------------------------- */
router.get("/user/:userId", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/user/:userId called at`, new Date().toISOString(), {
    userId: req.params.userId,
  });
  try {
    const bookings = await Booking.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    console.error("❌ Error fetching bookings:", error);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
});

/* -------------------------------------------------------------------------- */
/*              GET /booking/:id                                              */
/* -------------------------------------------------------------------------- */
router.get("/booking/:id", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/booking/:id called at`, new Date().toISOString(), {
    id: req.params.id,
  });
  try {
    const booking = await Booking.findById(req.params.id);
    res.json(booking);
  } catch (err) {
    console.error("❌ booking/:id fetch error:", err);
    res.status(500).json({ message: "Failed to fetch booking" });
  }
});

/* -------------------------------------------------------------------------- */
/*              GET /booking/user/:userId                                     */
/* -------------------------------------------------------------------------- */
router.get("/booking/user/:userId", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/booking/user/:userId called at`, new Date().toISOString(), {
    userId: req.params.userId,
  });
  try {
    const bookings = await Booking.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (e) {
    console.error("❌ userBookings error:", e);
    res.status(500).json({ error: "Failed to fetch user bookings" });
  }
});

/* -------------------------------------------------------------------------- */
/*              POST /manual-create                                           */
/* -------------------------------------------------------------------------- */
router.post("/manual-create", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/manual-create called at`, new Date().toISOString(), {
    user: req.user?.email || "unknown",
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, verifyToken, manualCreateBooking);

/* -------------------------------------------------------------------------- */
/*              POST /mark-musician-paid                                      */
/* -------------------------------------------------------------------------- */
router.post("/mark-musician-paid", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/mark-musician-paid called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, markMusicianAsPaid);

/* -------------------------------------------------------------------------- */
/*              GET /by-ref/:ref                                              */
/* -------------------------------------------------------------------------- */
router.get("/by-ref/:ref", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) GET /api/booking/by-ref/:ref called at`, new Date().toISOString(), {
    ref: req.params.ref,
  });
  next();
}, getBookingByRef);

/* -------------------------------------------------------------------------- */
/*              POST /notify-band                                             */
/* -------------------------------------------------------------------------- */
router.post("/notify-band", async (req, res) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/notify-band called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });

  try {
    const { bookingId, eventSheet } = req.body;
    if (!bookingId) return res.status(400).json({ success: false, message: "bookingId is required" });

    const query = { $or: [{ bookingId }, { _id: bookingId }] };
    const booking = await Booking.findOne(query);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    if (eventSheet && (eventSheet.answers || eventSheet.complete)) {
      booking.eventSheet = {
        ...(booking.eventSheet || {}),
        answers: { ...(booking.eventSheet?.answers || {}), ...(eventSheet.answers || {}) },
        complete: { ...(booking.eventSheet?.complete || {}), ...(eventSheet.complete || {}) },
        submitted: true,
        updatedAt: new Date().toISOString(),
      };
    } else {
      booking.eventSheet = {
        ...(booking.eventSheet || {}),
        submitted: true,
        updatedAt: new Date().toISOString(),
      };
    }

    booking.notifiedAt = new Date();
    await booking.save();
    return res.json({ success: true, booking });
  } catch (err) {
    console.error("❌ notify-band error:", err);
    return res.status(500).json({ success: false, message: "Failed to notify band" });
  }
});

/* -------------------------------------------------------------------------- */
/*              POST /update-event-sheet                                      */
/* -------------------------------------------------------------------------- */
router.post("/update-event-sheet", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) POST /api/booking/update-event-sheet called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, async (req, res) => {
  try {
    const { _id, bookingId, eventSheet } = req.body || {};
    if (!eventSheet)
      return res.status(400).json({ success: false, message: "Missing eventSheet" });

    let filter = null;
    const looksLikeObjectId = (v) =>
      typeof v === "string" &&
      mongoose.Types.ObjectId.isValid(v) &&
      String(new mongoose.Types.ObjectId(v)) === String(v);

    if (looksLikeObjectId(_id)) filter = { _id };
    else if (typeof bookingId === "string" && bookingId.trim())
      filter = { bookingId: bookingId.trim() };
    else return res.status(400).json({ success: false, message: "Provide _id or bookingId" });

    const doc = await Booking.findOneAndUpdate(
      filter,
      { $set: { eventSheet: { ...(eventSheet || {}), updatedAt: new Date() } } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Booking not found" });
    return res.json({ success: true, bookingId: doc.bookingId });
  } catch (e) {
    console.error("❌ update-event-sheet error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* -------------------------------------------------------------------------- */
/*              PUT /:bookingId/event-sheet                                   */
/* -------------------------------------------------------------------------- */
router.put("/:bookingId/event-sheet", (req, res, next) => {
  console.log(`✅ (routes/bookingRoutes.js) PUT /api/booking/:bookingId/event-sheet called at`, new Date().toISOString(), {
    bookingId: req.params.bookingId,
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { answers = {}, complete = {} } = req.body || {};

    const doc = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          "eventSheet.answers": answers,
          "eventSheet.complete": complete,
          "eventSheet.updatedAt": new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Booking not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("❌ event-sheet save error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;