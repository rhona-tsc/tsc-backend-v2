import express from "express";
import {
  getVatForecast,
  getCorporationTaxForecast,
} from "../controllers/financeTaxController.js";

const financeTaxRouter = express.Router();

financeTaxRouter.get("/vat-forecast", getVatForecast);
financeTaxRouter.get("/corporation-tax-forecast", getCorporationTaxForecast);

export default financeTaxRouter;