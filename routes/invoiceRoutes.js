// routes/invoiceRoutes.js
import express from "express";
import { getOrCreateBalanceLink } from "../controllers/invoicesController.js";

const router = express.Router();

router.get("/balance-link/:idOrRef", getOrCreateBalanceLink); // <-- use controller, param name = idOrRef

export default router;