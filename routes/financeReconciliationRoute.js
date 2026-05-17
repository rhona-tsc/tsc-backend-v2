import express from "express";

import {
  autoMatchFinanceTransactions,
  manualMatchFinanceTransaction,
} from "../controllers/financeReconciliationController.js";

const financeReconciliationRouter = express.Router();

financeReconciliationRouter.post("/auto-match", autoMatchFinanceTransactions);
financeReconciliationRouter.post("/manual-match", manualMatchFinanceTransaction);

export default financeReconciliationRouter;