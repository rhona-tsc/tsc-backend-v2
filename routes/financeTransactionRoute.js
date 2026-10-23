import express from "express";
import {
  createFinanceTransaction,
  getFinanceTransactions,
  getFinanceTransactionById,
  updateFinanceTransaction,
  deleteFinanceTransaction,
    importFinanceTransactionsCsv,
} from "../controllers/financeTransactionController.js";
import financeUpload from "../middleware/financeUpload.js";

const financeTransactionRouter = express.Router();

const upload = financeUpload(".csv");

financeTransactionRouter.post(
  "/import/csv",
  upload.single("file"),
  importFinanceTransactionsCsv,
);

financeTransactionRouter.post("/", createFinanceTransaction);
financeTransactionRouter.get("/", getFinanceTransactions);
financeTransactionRouter.get("/:id", getFinanceTransactionById);
financeTransactionRouter.put("/:id", updateFinanceTransaction);
financeTransactionRouter.delete("/:id", deleteFinanceTransaction);

export default financeTransactionRouter;
