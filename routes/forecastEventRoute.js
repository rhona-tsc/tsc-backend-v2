import express from "express";
import {
  getForecastEvents,
  createForecastEvent,
  updateForecastEvent,
  deleteForecastEvent,
  reconcileForecastEvent,
  unreconcileForecastEvent,
} from "../controllers/forecastEventController.js";

const forecastEventRouter = express.Router();

forecastEventRouter.get("/", getForecastEvents);
forecastEventRouter.post("/", createForecastEvent);
forecastEventRouter.put("/:id", updateForecastEvent);
forecastEventRouter.delete("/:id", deleteForecastEvent);

forecastEventRouter.post("/:id/reconcile", reconcileForecastEvent);
forecastEventRouter.post("/:id/unreconcile", unreconcileForecastEvent);

export default forecastEventRouter;