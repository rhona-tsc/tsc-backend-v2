import express from "express";
import { getOrCreateBalanceLink, getOrCreateAddonLink, createInvoicePayLink } from "../controllers/invoicesController.js";

const router = express.Router();

router.get("/balance-link/:idOrRef", getOrCreateBalanceLink);
router.get("/addon-link/:idOrRef", getOrCreateAddonLink);
router.post("/create", createInvoicePayLink);

export default router;