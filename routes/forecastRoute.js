import express from "express";
import {
  getForecastTimeline,
  getForecastMonthlySummary,
  syncBookingFromBoard,
} from "../controllers/forecastController.js";
const forecastRouter = express.Router();

forecastRouter.get("/monthly-summary", getForecastMonthlySummary);
forecastRouter.get("/timeline", getForecastTimeline);
forecastRouter.post("/bookings/sync-from-board/:bookingId", syncBookingFromBoard);

export default forecastRouter;