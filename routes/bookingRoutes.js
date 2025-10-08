import express from 'express';
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

import Booking from '../models/bookingModel.js'; // adjust path as needed
import mongoose from "mongoose";

// --- URL helpers for Stripe redirect URLs ---
function ensureHasScheme(urlLike) {
  if (!urlLike) return '';
  if (/^https?:\/\//i.test(urlLike)) return urlLike;      // already absolute
  return `http://${urlLike.replace(/^\/+/, '')}`;          // default to http in dev
}

function getFrontendOrigin(req) {
  // Priority: env → request Origin → dev fallback
  const fromEnv = process.env.FRONTEND_URL;                // e.g. http://localhost:5174 or https://yourdomain.com
  const envNormalized = fromEnv ? ensureHasScheme(fromEnv) : null;

  const fromHeader = req.headers?.origin;                  // e.g. http://localhost:5174
  const headerNormalized = fromHeader ? ensureHasScheme(fromHeader) : null;

  const fallback = 'http://localhost:5174';

  try {
    const chosen = envNormalized || headerNormalized || fallback;
    const u = new URL(chosen);                             // throws if invalid
    return `${u.protocol}//${u.host}`;                     // origin only
  } catch {
    return fallback;
  }
}

function requireAbsoluteUrl(u) {
  try {
    const parsed = new URL(u);
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return u;
  } catch (err) {
    throw new Error(
      `Invalid URL for Stripe redirect: "${u}". ` +
      `Make sure it includes http(s) and a host. (${err.message})`
    );
  }
}

const looksLikeObjectId = (v) =>
  typeof v === "string" && mongoose.Types.ObjectId.isValid(v) &&
  String(new mongoose.Types.ObjectId(v)) === String(v);


const router = express.Router();


router.post("/:id/ensure-emergency-contact", ensureEmergencyContact);

router.post('/create-checkout-session', createCheckoutSession);
router.get('/booking-complete', completeBookingV2); // e.g. /api/booking/booking-complete?session_id=xyz
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const bookings = await Booking.find({ userId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
});
router.get('/booking/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    res.json(booking);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch booking' });
  }
});
// e.g. routes/bookingRoute.js
router.get('/booking/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const bookings = await Booking.find({ userId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (e) {
    console.error('userBookings error:', e);
    res.status(500).json({ error: 'Failed to fetch user bookings' });
  }
});

router.post("/manual-create", verifyToken, manualCreateBooking);
router.post('/mark-musician-paid', markMusicianAsPaid);
router.get('/by-ref/:ref', getBookingByRef);


// --- Event Sheet: notify band ---
// expects: { bookingId: string, eventSheet?: { answers, complete } }
router.post('/notify-band', async (req, res) => {
  try {
    const { bookingId, eventSheet } = req.body;
    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }

    const query = { $or: [{ bookingId }, { _id: bookingId }] };
    const booking = await Booking.findOne(query);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Merge latest answers/complete if provided
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

    // TODO: trigger any real notifications (email/slack) here.

    return res.json({ success: true, booking });
  } catch (err) {
    console.error('notify-band error:', err);
    return res.status(500).json({ success: false, message: 'Failed to notify band' });
  }
});

router.post("/update-event-sheet", async (req, res) => {
  try {
    const { _id, bookingId, eventSheet } = req.body || {};
    if (!eventSheet) {
      return res.status(400).json({ success: false, message: "Missing eventSheet" });
    }

    let filter = null;
    const looksLikeObjectId = (v) =>
      typeof v === "string" && mongoose.Types.ObjectId.isValid(v) &&
      String(new mongoose.Types.ObjectId(v)) === String(v);

    if (looksLikeObjectId(_id)) {
      filter = { _id };
    } else if (typeof bookingId === "string" && bookingId.trim()) {
      filter = { bookingId: bookingId.trim() };
    } else {
      return res.status(400).json({ success: false, message: "Provide _id or bookingId" });
    }

    const doc = await Booking.findOneAndUpdate(
      filter,
      { $set: { eventSheet: { ...(eventSheet || {}), updatedAt: new Date() } } },
      { new: true }
    ).lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    return res.json({ success: true, bookingId: doc.bookingId });
  } catch (e) {
    console.error("update-event-sheet error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/booking/:bookingId/event-sheet
router.put("/:bookingId/event-sheet", async (req, res) => {
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
    console.error("event-sheet save error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;