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
} from "../controllers/deputyJobController.js";
import authUser from "../middleware/auth.js";

const deputyJobRouter = express.Router();

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

deputyJobRouter.post("/:id/preview-notification", authUser, previewDeputyJobNotification);
deputyJobRouter.post("/:id/send-test-notification", authUser, sendDeputyJobTestNotification);
deputyJobRouter.post("/:id/resend-notifications", authUser, resendDeputyJobNotifications);
/**
 * Create / list
 * POST /api/deputy-jobs/preview
 * Build the job, run matcher, and return preview output without actually sending.
 */
deputyJobRouter.post("/preview", authUser, previewDeputyJob);

/**
 * POST /api/deputy-jobs
 * Create the actual deputy job.
 * Controller can still support req.query.preview=true if you want,
 * but keeping preview as its own route makes frontend flow cleaner.
 */
deputyJobRouter.post("/", authUser, createDeputyJob);

/**
 * GET /api/deputy-jobs
 * List all deputy jobs visible to the current user.
 */
deputyJobRouter.get("/", authUser, listDeputyJobs);

/**
 * Read job + matches
 * IMPORTANT: keep /:id/matches before /:id
 */
deputyJobRouter.get("/:id/matches", authUser, listDeputyJobMatches);
deputyJobRouter.get("/:id", authUser, getDeputyJobById);

/**
 * Send notifications after preview confirmation
 * POST /api/deputy-jobs/:id/send-notifications
 */
deputyJobRouter.post(
  "/:id/send-notifications",
  authUser,
  sendDeputyJobNotifications
);

/**
 * Payment setup + charging
 * 1. Create a SetupIntent to save the client card
 * 2. Save the resulting default payment method
 * 3. Optionally trigger a manual charge
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

deputyJobRouter.post(
  "/:id/charge",
  authUser,
  chargeDeputyJob
);

/**
 * Daily payout cron
 * POST /api/deputy-jobs/run-payout-cron
 * Protected with x-cron-secret header checked in the controller.
 */
deputyJobRouter.post("/run-payout-cron", runDeputyPayoutCron);

/**
 * Applications
 * POST /api/deputy-jobs/:id/apply
 * Musician applies to the job
 */
deputyJobRouter.post("/:id/apply", authUser, applyToDeputyJob);

/**
 * PATCH /api/deputy-jobs/:id/applications/:musicianId/status
 * Admin/agent updates application state:
 * applied / shortlisted / allocated / booked / declined / withdrawn
 */
deputyJobRouter.patch(
  "/:id/applications/:musicianId/status",
  authUser,
  updateDeputyJobApplicationStatus
);

/**
 * Allocation workflow
 * 1. Preview allocation email
 * 2. Confirm allocation
 * 3. Preview booking confirmation email
 * 4. Send booking confirmation email
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