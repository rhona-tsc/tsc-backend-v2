// routes/boardBackfillRoutes.js (temp)
import express from "express";
import Booking from "../models/bookingModel.js";
import { upsertBoardRowFromBooking } from "../controllers/bookingController.js";
const r = express.Router();

r.post("/board/backfill/:bookingRefOrId", async (req, res) => {
  try {
    const k = req.params.bookingRefOrId;
    let booking = await Booking.findOne({ bookingId: k });
    if (!booking && k.match(/^[0-9a-fA-F]{24}$/)) booking = await Booking.findById(k);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    await upsertBoardRowFromBooking(booking);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

export default r;