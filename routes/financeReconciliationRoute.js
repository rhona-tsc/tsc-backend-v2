import express from "express";

import { autoMatchFinanceTransactions } from "../controllers/financeReconciliationController.js";

const financeReconciliationRouter = express.Router();

financeReconciliationRouter.post("/auto-match", autoMatchFinanceTransactions);

export default financeReconciliationRouter;