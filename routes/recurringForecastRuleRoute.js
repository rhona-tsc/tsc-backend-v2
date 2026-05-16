import express from "express";
import {
  createRecurringForecastRule,
  getRecurringForecastRules,
  getRecurringForecastRuleById,
  updateRecurringForecastRule,
  deleteRecurringForecastRule,
  generateForecastEventsFromRecurringRules,
} from "../controllers/recurringForecastRuleController.js";

const recurringForecastRuleRouter = express.Router();

recurringForecastRuleRouter.post(
  "/generate",
  generateForecastEventsFromRecurringRules,
);

recurringForecastRuleRouter.post("/", createRecurringForecastRule);
recurringForecastRuleRouter.get("/", getRecurringForecastRules);
recurringForecastRuleRouter.get("/:id", getRecurringForecastRuleById);
recurringForecastRuleRouter.put("/:id", updateRecurringForecastRule);
recurringForecastRuleRouter.delete("/:id", deleteRecurringForecastRule);

export default recurringForecastRuleRouter;