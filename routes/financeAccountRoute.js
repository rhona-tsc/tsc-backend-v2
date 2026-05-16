import express from "express";
import {
  createFinanceAccount,
  getFinanceAccounts,
  getFinanceAccountById,
  updateFinanceAccount,
  deleteFinanceAccount,
} from "../controllers/financeAccountController.js";

const financeAccountRouter = express.Router();

financeAccountRouter.post("/", createFinanceAccount);
financeAccountRouter.get("/", getFinanceAccounts);
financeAccountRouter.get("/:id", getFinanceAccountById);
financeAccountRouter.put("/:id", updateFinanceAccount);
financeAccountRouter.delete("/:id", deleteFinanceAccount);

export default financeAccountRouter;