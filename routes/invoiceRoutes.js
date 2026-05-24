import express from "express";
import { getOrCreateBalanceLink, getOrCreateAddonLink, createInvoicePayLink, createBoardInvoice } from "../controllers/invoicesController.js";
import bookingBoardItem from "../models/bookingBoardItem.js";

const router = express.Router();

router.get("/balance-link/:idOrRef", getOrCreateBalanceLink);
router.get("/addon-link/:idOrRef", getOrCreateAddonLink);
router.post("/create", createInvoicePayLink);
router.post("/create-board-invoice", createBoardInvoice);
router.get("/board-invoice/:bookingId", async (req, res) => {
  const row = await bookingBoardItem.findById(req.params.bookingId).lean();

  const invoicePdfUrl =
    row?.invoicePdfUrl ||
    row?.invoiceUrl ||
    row?.payments?.boardInvoicePdfUrl ||
    "";

  if (!invoicePdfUrl) {
    console.log("❌ Invoice not found on row:", {
      id: req.params.bookingId,
      rowFound: Boolean(row),
      invoicePdfUrl: row?.invoicePdfUrl,
      invoiceUrl: row?.invoiceUrl,
      payments: row?.payments,
    });

    return res.status(404).send("Invoice not found");
  }

  const pdfRes = await fetch(invoicePdfUrl);
  const buffer = Buffer.from(await pdfRes.arrayBuffer());

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${row.bookingRef || row._id}.pdf"`
  );

  return res.send(buffer);
});

export default router;