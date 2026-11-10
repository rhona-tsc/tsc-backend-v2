// routes/deputyJobRoute.js
import express from "express";
import {
  createDeputyJob,
  listDeputyJobs,
  getDeputyJobById,
  getDeputyJobApplications,
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
  listDeputyPayments,
  twilioInboundDeputyJob,
  twilioInboundDeputyAllocation,
  previewDeputyJobNotification,
  sendDeputyJobTestNotification,
  resendDeputyJobNotifications,
  sendDeputyJobNotificationsToUnnotified,
  sendRemainingDeputyJobNotifications,
  rematchAndSendDeputyJobNotifications,
  closeDeputyJob,
  manualAllocateDeputyJob,
  presentDeputyApplicant,
  retryFailedDeputyJobNotifications,
  manualApplyDeputyJob,
  manualApplyAndPresentDeputyJob,
  trackDeputyPresentationView,
} from "../controllers/deputyJobController.js";
import authUser, { optionalAuthUser } from "../middleware/auth.js";
import deputyJobModel from '../models/deputyJobModel.js';
import { deputyJobManagerGuard } from '../middleware/deputyJobManager.js';

const deputyJobRouter = express.Router();

// Optional-auth responses differ per viewer and must never be shared by a cache.
deputyJobRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

/**
 * Twilio inbound webhooks
 * These must stay public and use form-urlencoded parsing.
 */
deputyJobRouter.post(
  "/twilio/inbound",
  express.urlencoded({ extended: false }),
  twilioInboundDeputyJob,
);

deputyJobRouter.post(
  "/twilio/inbound-allocation",
  express.urlencoded({ extended: false }),
  twilioInboundDeputyAllocation,
);

deputyJobRouter.post(
  "/track-presentation-view",
  express.json(),
  trackDeputyPresentationView,
);

// All job subroutes are management-only except applying as the logged-in musician.
// Leave the public list/detail and signed Twilio/tracking flows above unchanged.
const requireJobManager = deputyJobManagerGuard(id => deputyJobModel.findById(id)
  .select('createdBy createdByEmail managerEmail').lean());
deputyJobRouter.use('/:id/:action', (req, res, next) => {
  if (req.params.action === 'apply') return next();
  return authUser(req, res, () => requireJobManager(req, res, next));
});

/**
 * Preview / test / resend notifications for an existing job
 */
deputyJobRouter.post(
  "/:id/preview-notification",
  authUser,
  previewDeputyJobNotification,
);

deputyJobRouter.post(
  "/:id/send-test-notification",
  authUser,
  sendDeputyJobTestNotification,
);

deputyJobRouter.post(
  "/:id/resend-notifications",
  authUser,
  resendDeputyJobNotifications,
);

deputyJobRouter.post(
  "/:id/send-unnotified-notifications",
  authUser,
  sendDeputyJobNotificationsToUnnotified,
);

deputyJobRouter.post(
  "/:id/send-remaining-notifications",
  authUser,
  sendRemainingDeputyJobNotifications,
);

/**
 * Create / list
 */
deputyJobRouter.post("/preview", authUser, previewDeputyJob);
deputyJobRouter.post("/", authUser, createDeputyJob);
deputyJobRouter.get(
  "/",
  (req, res, next) => {
    res.set("Cache-Control", "no-store");

    next();
  },
  optionalAuthUser,
  listDeputyJobs,
);

deputyJobRouter.get("/payments", authUser, listDeputyPayments);

/**
 * Defaults to a non-mutating preview. Sending { dryRun: false } can only
 * transfer when AUTO_DEPUTY_PAYOUTS_ENABLED=true and the cron secret matches.
 */
deputyJobRouter.post("/run-payout-cron", runDeputyPayoutCron);

/**
 * Read job + matches
 * Keep /:id/matches before /:id
 */
deputyJobRouter.get("/:id/matches", authUser, listDeputyJobMatches);
deputyJobRouter.get("/:id", optionalAuthUser, getDeputyJobById);
deputyJobRouter.get("/:id/applications", authUser, getDeputyJobApplications);

/**
 * Send notifications after preview confirmation
 */
deputyJobRouter.post(
  "/:id/send-notifications",
  authUser,
  sendDeputyJobNotifications,
);

deputyJobRouter.post(
  "/:id/rematch-and-send-notifications",
  authUser,
  rematchAndSendDeputyJobNotifications,
);

deputyJobRouter.post(
  "/:id/retry-failed-notifications",
  authUser,
  retryFailedDeputyJobNotifications,
);

deputyJobRouter.post("/:id/close", authUser, closeDeputyJob);

deputyJobRouter.post(
  "/:id/present-applicant",
  authUser,
  presentDeputyApplicant,
);

deputyJobRouter.post("/:id/manual-allocate", authUser, manualAllocateDeputyJob);

deputyJobRouter.post("/:id/manual-apply", authUser, manualApplyDeputyJob);

deputyJobRouter.post(
  "/:id/manual-apply-and-present",
  authUser,
  manualApplyAndPresentDeputyJob,
);

/**
 * Enquiry-only deputy jobs
 * Separate endpoint for enquiry posts that do not require card setup.
 */

/**
 * Payment setup + charging
 */
deputyJobRouter.post(
  "/:id/create-setup-intent",
  authUser,
  createDeputyJobSetupIntent,
);

deputyJobRouter.post(
  "/:id/save-payment-method",
  authUser,
  saveDeputyJobPaymentMethod,
);

deputyJobRouter.post("/:id/charge", authUser, chargeDeputyJob);

/**
 * Daily payout cron
 * Protected in controller with cron secret
 */

/**
 * Applications
 */
deputyJobRouter.post("/:id/apply", authUser, applyToDeputyJob);

deputyJobRouter.patch(
  "/:id/applications/:musicianId/status",
  authUser,
  updateDeputyJobApplicationStatus,
);

/**
 * Allocation workflow
 */
deputyJobRouter.post(
  "/:id/preview-allocation",
  authUser,
  previewDeputyAllocation,
);

deputyJobRouter.post(
  "/:id/confirm-allocation",
  authUser,
  confirmDeputyAllocation,
);

deputyJobRouter.post(
  "/:id/preview-booking-email",
  authUser,
  previewDeputyBookingEmail,
);

deputyJobRouter.post(
  "/:id/send-booking-email",
  authUser,
  sendDeputyBookingEmail,
);

export default deputyJobRouter;
