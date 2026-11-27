import express from "express";
import requireStaffAuth from "../middleware/requireStaffAuth.js";
import { docSigningRequest, sendMenuToBand, sendDietaryToCaterer } from "../controllers/notificationsController.js";

const router = express.Router();
// These operations disclose private dietary data and send external mail.
// A client or musician session must never authorize them.
router.use(requireStaffAuth);

router.post("/doc-signing-request", docSigningRequest);
router.post("/menu-to-band", sendMenuToBand);
router.post("/dietary-to-caterer", sendDietaryToCaterer);

export default router;
