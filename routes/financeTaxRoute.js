import express from "express";
import {
  getVatForecast,
  getCorporationTaxForecast,
  generateTaxForecastEvents,
} from "../controllers/financeTaxController.js";

const financeTaxRouter = express.Router();

financeTaxRouter.get("/vat-forecast", getVatForecast);
financeTaxRouter.get("/corporation-tax-forecast", getCorporationTaxForecast);
financeTaxRouter.post("/generate-forecast-events", generateTaxForecastEvents);

export default financeTaxRouter;