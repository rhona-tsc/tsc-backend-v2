// routes/newsletterRoutes.js
import express from 'express';
import { subscribeToVoucher } from '../controllers/mailchimpController.js';

const router = express.Router();
router.post('/newsletter/subscribe', subscribeToVoucher);
export default router;