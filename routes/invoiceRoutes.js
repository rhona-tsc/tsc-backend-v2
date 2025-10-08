// routes/invoiceRoutes.js
import express from "express";
import { scheduleBalance, getOrCreateBalanceLink } from "../controllers/invoicesController.js";

const router = express.Router();

router.get("/balance-link/:idOrRef", getOrCreateBalanceLink); // <-- use controller, param name = idOrRef
router.post("/schedule-balance", scheduleBalance);

export default router;