// routes/deputyJobRoute.js
import express from "express";
import {
  createDeputyJob,
  listDeputyJobs,
  getDeputyJobById,
  applyToDeputyJob,
  previewDeputyJob,
  sendDeputyJobNotifications,
  listDeputyJobMatches,
  previewDeputyAllocation,
  confirmDeputyAllocation,
  previewDeputyBookingEmail,
  sendDeputyBookingEmail,
  updateDeputyJobApplicationStatus,
  createDeputyJobSetupIntent,
  saveDeputyJobPaymentMethod,
  chargeDeputyJob,
  runDeputyPayoutCron,
  twilioInboundDeputyJob,
  twilioInboundDeputyAllocation,
  previewDeputyJobNotification,
  sendDeputyJobTestNotification,
  resendDeputyJobNotifications,
  sendDeputyJobNotificationsToUnnotified,
  sendRemainingDeputyJobNotifications,
} from "../controllers/deputyJobController.js";
import authUser from "../middleware/auth.js";
import { auth } from "googleapis/build/src/apis/abusiveexperiencereport/index.js";

const deputyJobRouter = express.Router();

/**
 * Twilio inbound webhooks
 * These must stay public and use form-urlencoded parsing.
 */
deputyJobRouter.post(
  "/twilio/inbound",
  express.urlencoded({ extended: false }),
  twilioInboundDeputyJob
);

deputyJobRouter.post(
  "/twilio/inbound-allocation",
  express.urlencoded({ extended: false }),
  twilioInboundDeputyAllocation
);

/**
 * Preview / test / resend notifications for an existing job
 */
deputyJobRouter.post(
  "/:id/preview-notification",
  authUser,
  previewDeputyJobNotification
);

deputyJobRouter.post(
  "/:id/send-test-notification",
  authUser,
  sendDeputyJobTestNotification
);

deputyJobRouter.post(
  "/:id/resend-notifications",
  authUser,
  resendDeputyJobNotifications
);

deputyJobRouter.post(
  "/:id/send-unnotified-notifications",
  authUser,
  sendDeputyJobNotificationsToUnnotified
);

deputyJobRouter.post(
  "/:id/send-remaining-notifications",
  authUser,
  sendRemainingDeputyJobNotifications
);

/**
 * Create / list
 */
deputyJobRouter.post("/preview", authUser, previewDeputyJob);
deputyJobRouter.post("/", authUser, createDeputyJob);
deputyJobRouter.get("/", authUser, listDeputyJobs);

/**
 * Read job + matches
 * Keep /:id/matches before /:id
 */
deputyJobRouter.get("/:id/matches", authUser, listDeputyJobMatches);
deputyJobRouter.get("/:id", authUser, getDeputyJobById);

/**
 * Send notifications after preview confirmation
 */
deputyJobRouter.post(
  "/:id/send-notifications",
  authUser,
  sendDeputyJobNotifications
);

/**
 * Payment setup + charging
 */
deputyJobRouter.post(
  "/:id/create-setup-intent",
  authUser,
  createDeputyJobSetupIntent
);

deputyJobRouter.post(
  "/:id/save-payment-method",
  authUser,
  saveDeputyJobPaymentMethod
);

deputyJobRouter.post("/:id/charge", authUser, chargeDeputyJob);

/**
 * Daily payout cron
 * Protected in controller with cron secret
 */
deputyJobRouter.post("/run-payout-cron", runDeputyPayoutCron);

/**
 * Applications
 */
deputyJobRouter.post("/:id/apply", authUser, applyToDeputyJob);

deputyJobRouter.patch(
  "/:id/applications/:musicianId/status",
  authUser,
  updateDeputyJobApplicationStatus
);

/**
 * Allocation workflow
 */
deputyJobRouter.post(
  "/:id/preview-allocation",
  authUser,
  previewDeputyAllocation
);

deputyJobRouter.post(
  "/:id/confirm-allocation",
  authUser,
  confirmDeputyAllocation
);

deputyJobRouter.post(
  "/:id/preview-booking-email",
  authUser,
  previewDeputyBookingEmail
);

deputyJobRouter.post(
  "/:id/send-booking-email",
  authUser,
  sendDeputyBookingEmail
);

export default deputyJobRouter;