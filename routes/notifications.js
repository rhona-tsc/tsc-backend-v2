import express from "express";
import requireAnyAuth from "../middleware/requireAnyAuth.js";
import { docSigningRequest, sendMenuToBand, sendDietaryToCaterer } from "../controllers/notificationsController.js";

const router = express.Router();
router.use(requireAnyAuth);

router.post("/doc-signing-request", docSigningRequest);
router.post("/menu-to-band", sendMenuToBand);
router.post("/dietary-to-caterer", sendDietaryToCaterer);

export default router;
