import express from "express";
import {
  createBookingForecast,
  updateBookingForecast,
  getBookingForecasts,
  getBookingForecastById,
  deleteBookingForecast,
} from "../controllers/bookingForecastController.js";

const bookingForecastRouter = express.Router();

bookingForecastRouter.post("/", createBookingForecast);
bookingForecastRouter.get("/", getBookingForecasts);
bookingForecastRouter.get("/:id", getBookingForecastById);
bookingForecastRouter.put("/:id", updateBookingForecast);
bookingForecastRouter.delete("/:id", deleteBookingForecast);

export default bookingForecastRouter;