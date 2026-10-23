import express from "express";
import multer from "multer";

import {
  createBookingForecast,
  getBookingForecasts,
  getBookingForecastById,
  updateBookingForecast,
  deleteBookingForecast,
  importMondayBookingForecasts,
  importGigForecastBookings,
} from "../controllers/bookingForecastController.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 20, parts: 21 } });

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
