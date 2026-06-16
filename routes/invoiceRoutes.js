import express from "express";
import { getOrCreateBalanceLink, getOrCreateAddonLink, createInvoicePayLink, createBoardInvoice, serveBoardReceiptPdf, serveBoardInvoicePdf } from "../controllers/invoicesController.js";

const router = express.Router();

router.get("/balance-link/:idOrRef", getOrCreateBalanceLink);
router.get("/addon-link/:idOrRef", getOrCreateAddonLink);
router.post("/create", createInvoicePayLink);
router.post("/create-board-invoice", createBoardInvoice);
router.get("/board-receipt/:id", serveBoardReceiptPdf);
router.get("/board-invoice-pdf/:id", serveBoardInvoicePdf);


export default router;