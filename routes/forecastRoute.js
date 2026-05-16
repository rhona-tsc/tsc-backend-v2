import express from "express";
import {
  getForecastTimeline,
  getForecastMonthlySummary,
} from "../controllers/forecastController.js";
const forecastRouter = express.Router();

forecastRouter.get("/monthly-summary", getForecastMonthlySummary);
forecastRouter.get("/timeline", getForecastTimeline);

export default forecastRouter;