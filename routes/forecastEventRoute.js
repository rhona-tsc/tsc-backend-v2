import express from "express";
import {
  reconcileForecastEvent,
  unreconcileForecastEvent,
} from "../controllers/forecastEventController.js";

const forecastEventRouter = express.Router();

forecastEventRouter.post("/:id/reconcile", reconcileForecastEvent);
forecastEventRouter.post("/:id/unreconcile", unreconcileForecastEvent);

export default forecastEventRouter;