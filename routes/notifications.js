import express from "express";
import { docSigningRequest, sendMenuToBand, sendDietaryToCaterer } from "../controllers/notificationsController.js";

const router = express.Router();

router.post("/doc-signing-request", docSigningRequest);
router.post("/menu-to-band", sendMenuToBand);
router.post("/dietary-to-caterer", sendDietaryToCaterer);

export default router;
