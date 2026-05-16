import express from "express";
import {
  createFinanceTransaction,
  getFinanceTransactions,
  getFinanceTransactionById,
  updateFinanceTransaction,
  deleteFinanceTransaction,
} from "../controllers/financeTransactionController.js";

const financeTransactionRouter = express.Router();

financeTransactionRouter.post("/", createFinanceTransaction);
financeTransactionRouter.get("/", getFinanceTransactions);
financeTransactionRouter.get("/:id", getFinanceTransactionById);
financeTransactionRouter.put("/:id", updateFinanceTransaction);
financeTransactionRouter.delete("/:id", deleteFinanceTransaction);

export default financeTransactionRouter;