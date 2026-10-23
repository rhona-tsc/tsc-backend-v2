import express from "express";
import financeUpload from "../middleware/financeUpload.js";

import {
  createBookingForecast,
  getBookingForecasts,
  getBookingForecastById,
  updateBookingForecast,
  deleteBookingForecast,
  importMondayBookingForecasts,
  importGigForecastBookings,
} from "../controllers/bookingForecastController.js";

const upload = financeUpload(".xlsx");

const bookingForecastRouter = express.Router();

bookingForecastRouter.post("/import/monday", upload.single("file"), importMondayBookingForecasts);

bookingForecastRouter.post("/", createBookingForecast);
bookingForecastRouter.get("/", getBookingForecasts);
bookingForecastRouter.get("/:id", getBookingForecastById);
bookingForecastRouter.put("/:id", updateBookingForecast);
bookingForecastRouter.delete("/:id", deleteBookingForecast);
bookingForecastRouter.post(
  "/import/gig-forecast",
  upload.single("file"),
  importGigForecastBookings,
);

export default bookingForecastRouter;
