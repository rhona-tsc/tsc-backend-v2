import express from "express";
import {
  createFinanceTransaction,
  getFinanceTransactions,
  getFinanceTransactionById,
  updateFinanceTransaction,
  deleteFinanceTransaction,
    importFinanceTransactionsCsv,
} from "../controllers/financeTransactionController.js";
import multer from "multer";

const financeTransactionRouter = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

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