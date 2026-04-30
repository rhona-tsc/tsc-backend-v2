import express from "express";
import {
  changePhone,
  changeEmail,
  changePassword,
  createStripeConnectOnboardingLink,
} from "../controllers/account.js";

console.log("🔍 Using auth middleware from:", new URL("../middleware/auth.js", import.meta.url).pathname);
import auth from "../middleware/auth.js";

const router = express.Router();

router.use((req, _res, next) => {
  console.log(`🧭 [${req._rid || 'no-rid'}] accountRoute hit: ${req.method} ${req.originalUrl}`);
  next();
});

router.post(
  '/change-phone',
  (req, _res, next) => { console.log(`➡️  [${req._rid || 'no-rid'}] entering auth for change-phone`); next(); },
  auth,
  (req, _res, next) => { console.log(`✅ [${req._rid || 'no-rid'}] passed auth for change-phone`); next(); },
  changePhone
);

router.post(
  '/change-email',
  (req, _res, next) => { console.log(`➡️  [${req._rid || 'no-rid'}] entering auth for change-email`); next(); },
  auth,
  (req, _res, next) => { console.log(`✅ [${req._rid || 'no-rid'}] passed auth for change-email`); next(); },
  changeEmail
);

router.post(
  '/change-password',
  (req, _res, next) => { console.log(`➡️  [${req._rid || 'no-rid'}] entering auth for change-password`); next(); },
  auth,
  (req, _res, next) => { console.log(`✅ [${req._rid || 'no-rid'}] passed auth for change-password`); next(); },
  changePassword
);

router.post(
  "/stripe-connect/onboarding-link",
  (req, _res, next) => {
    console.log(`➡️  [${req._rid || "no-rid"}] entering auth for stripe-connect/onboarding-link`);
    next();
  },
  auth,
  (req, _res, next) => {
    console.log(`✅ [${req._rid || "no-rid"}] passed auth for stripe-connect/onboarding-link`);
    next();
  },
  createStripeConnectOnboardingLink
);

export default router;