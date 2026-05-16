import express from "express";
import { getForecastTimeline } from "../controllers/forecastController.js";

const forecastRouter = express.Router();

forecastRouter.get("/timeline", getForecastTimeline);

export default forecastRouter;