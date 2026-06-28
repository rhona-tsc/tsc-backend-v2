import express from "express";
import {
  getVatForecast,
  getCorporationTaxForecast,
  generateTaxForecastEvents,
 syncVatForecastEvents ,
} from "../controllers/financeTaxController.js";

const financeTaxRouter = express.Router();

financeTaxRouter.get("/vat-forecast", getVatForecast);
financeTaxRouter.get("/corporation-tax-forecast", getCorporationTaxForecast);
financeTaxRouter.post("/generate-forecast-events", generateTaxForecastEvents);
financeTaxRouter.post("/sync-vat-forecast-events", syncVatForecastEvents);

export default financeTaxRouter;