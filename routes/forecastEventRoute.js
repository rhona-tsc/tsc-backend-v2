import express from "express";
import {
  getForecastEvents,
  reconcileForecastEvent,
  unreconcileForecastEvent,
} from "../controllers/forecastEventController.js";

const forecastEventRouter = express.Router();

forecastEventRouter.get("/", getForecastEvents);
forecastEventRouter.post("/:id/reconcile", reconcileForecastEvent);
forecastEventRouter.post("/:id/unreconcile", unreconcileForecastEvent);

export default forecastEventRouter;