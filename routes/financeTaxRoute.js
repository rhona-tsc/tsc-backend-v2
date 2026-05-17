import express from "express";
import { getVatForecast } from "../controllers/financeTaxController.js";

const financeTaxRouter = express.Router();

financeTaxRouter.get("/vat-forecast", getVatForecast);

export default financeTaxRouter;