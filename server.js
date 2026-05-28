// backend/server.js
import express from "express";
import cors from "cors";
import "dotenv/config";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cron from "node-cron";
import listEndpoints from "express-list-endpoints";
import Stripe from "stripe";
import { dedupeSelectedSongsForAllMusicians, startDedupeSelectedSongsCron } from "./cron/dedupeSelectedSongsCron.js";
import connectDB from "./config/mongodb.js";
import connectCloudinary from "./config/connectCloudinary.js";
import cloudinary from "./config/cloudinary.js";
import bookingForecastRouter from "./routes/bookingForecastRoute.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import noticeRoutes from "./routes/noticeRoutes.js";
import actPreSubmissionRoutes from "./routes/actPreSubmissionRoutes.js";
import shortlistRoutes from "./routes/shortlist.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import userRouter from "./routes/userRoute.js";
import musicianRouter from "./routes/musicianRoute.js";
import actV2Routes from "./routes/actV2Routes.js";
import cartRouter from "./routes/cartRoute.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import googleRoutes from "./routes/google.js";
import calendarWebhook from "./routes/calendarWebhook.js";
import authRoutes from "./routes/authRoutes.js";
import moderationRoutes from "./routes/moderationRoutes.js";
import debugRoutes from "./routes/debug.js";
import musicianLoginRouter from "./routes/musicianLoginRoute.js";
import allocationRoutes from "./routes/allocationRoutes.js";
import availabilityRoutes from "./routes/availability.js";
import paymentsRouter from "./routes/payments.js";
import accountRouter from "./routes/accountRoute.js";
import bookingBoardRoutes from "./routes/bookingBoardRoutes.js";
import uploadRoutes from "./routes/upload.js";
import newsletterRoutes from "./routes/newsletterRoutes.js";
import v2Routes from "./routes/v2.js";
import agentDashboardRoutes from "./routes/agentDashboardRoutes.js";
import sitemapRoutes from "./routes/sitemapRoutes.js";
import enquiryBoardRoutes from "./routes/enquiryBoardRoutes.js";
import adminRoutes from "./routes/admin.js";
import messageRoutes from "./routes/messageRoutes.js";
import deputyOpportunityRoutes from "./routes/deputyOpportunityRoutes.js";
import deputyJobRouter from "./routes/deputyJobRoute.js";
import forecastRouter from "./routes/forecastRoute.js";
import financeAccountRouter from "./routes/financeAccountRoute.js";
import financeTransactionRouter from "./routes/financeTransactionRoute.js";
import forecastEventRouter from "./routes/forecastEventRoute.js";
import recurringForecastRuleRouter from "./routes/recurringForecastRuleRoute.js";
import {
  watchCalendar,
  handleGoogleWebhook,
} from "./controllers/googleController.js";

import {
  twilioInbound,
  twilioStatus,
  buildAvailabilityBadgeFromRows,
  processDueDeputyEscalations,
} from "./controllers/availabilityController.js";

import { getAvailableActIds } from "./controllers/actAvailabilityController.js";
import { startRemindersPoller } from "./services/remindersQueue.js";
import { runChaseAndEscalation } from "./cron/chaseAndEscalate.js";
import actModel from "./models/actModel.js";
import { runDeputyPayoutRelease } from "./services/deputyPayoutService.js";
import Booking from "./models/bookingModel.js";
import financeReconciliationRouter from "./routes/financeReconciliationRoute.js";
import financeTaxRouter from "./routes/financeTaxRoute.js";
import financeForecastRoutes from "./routes/financeForecastRoutes.js";

/* -------------------------------------------------------------------------- */
/*                               Boot + env log                               */
/* -------------------------------------------------------------------------- */

console.log("ENV CHECK:", {
  INTERNAL_BASE_URL: process.env.INTERNAL_BASE_URL,
  BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
  BACKEND_URL: process.env.BACKEND_URL,
  STRIPE_CONFIGURED: Boolean(process.env.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_CONFIGURED: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
});

const app = express();
const port = process.env.PORT || 4000;

app.set("trust proxy", 1); // Render/Cloudflare

/* -------------------------------------------------------------------------- */
/*                                    CORS                                    */
/* -------------------------------------------------------------------------- */

// Host-based allowlist
const ALLOWED_HOSTS = new Set([
  "localhost:5173",
  "localhost:5174",

  // ✅ Allow apex + subdomains
  "thesupremecollective.co.uk",
  "admin.thesupremecollective.co.uk",
  "www.thesupremecollective.co.uk",
  "api.thesupremecollective.co.uk",

  "tsc2025.netlify.app",
  "tsc-backend-v2.onrender.com",
  "tsc2025.onrender.com",
]);

const ALLOW_HEADERS =
  "Content-Type, Authorization, token, Cache-Control, Pragma, X-Requested-With, X-Request-Id, x-request-id, X-Idempotency-Key, x-idempotency-key, Useremail, Userid, Userrole, useremail, userid, userrole";
function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser clients
  try {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol)) return false;
    return (
      ALLOWED_HOSTS.has(url.host) ||
      url.hostname === "thesupremecollective.co.uk" ||
      url.hostname.endsWith(".thesupremecollective.co.uk") ||
      url.host.endsWith(".netlify.app") ||
      url.host.includes("localhost")
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ALLOW_HEADERS.split(",").map((h) => h.trim()),
  })
);

// Let cors handle preflights globally
app.options("*", cors());

/* -------------------------------------------------------------------------- */
/*                             Standard middleware                              */
/* -------------------------------------------------------------------------- */

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use(cookieParser());

/* -------------------------------------------------------------------------- */
/*                               Stripe (shared)                               */
/* -------------------------------------------------------------------------- */

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

if (!stripeSecretKey) {
  console.warn(
    "⚠️ STRIPE_SECRET_KEY missing — Stripe routes + webhooks will fail."
  );
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" })
  : null;

/**
 * IMPORTANT:
 * This webhook MUST be defined BEFORE express.json(), because it needs req.body as raw bytes.
 * Stripe dashboard webhook URL should be:
 *   https://<backend>/api/payments/stripe-webhook
 */
app.post(
  "/api/payments/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) {
      console.error("⚠️ Stripe webhook hit but STRIPE_SECRET_KEY is missing.");
      return res.status(500).send("Stripe not configured");
    }

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(
        "⚠️ Stripe webhook signature verification failed:",
        err.message
      );
      return res.sendStatus(400);
    }
// ------------------------------------------------------------------
// Stripe webhook handlers
// ------------------------------------------------------------------

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toMajor = (amountMinor) => safeNum(amountMinor) / 100;

const normaliseStage = (v) => String(v || "").trim().toLowerCase();

const getVatSplitFromGross = (grossMajor, vatRate) => {
  const rate = Number.isFinite(vatRate) ? vatRate : 0.2;
  const vat = Math.round(grossMajor * (rate / (1 + rate)) * 100) / 100;
  const net = Math.round((grossMajor - vat) * 100) / 100;
  return { vat, net };
};

const looksLikeObjectId = (v) =>
  typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);

const findBookingByMeta = async (meta = {}) => {
  // You sometimes store bookingId as booking_ref in Stripe metadata
  const bookingRef = String(
    meta.bookingId || meta.booking_ref || meta.booking_id || ""
  ).trim();

  const bookingMongoId = String(
    meta.bookingMongoId || meta.booking_mongo_id || ""
  ).trim();

  // 1) Try mongo id first (most precise)
  if (bookingMongoId && looksLikeObjectId(bookingMongoId)) {
    const byId = await Booking.findById(bookingMongoId);
    if (byId) return byId;
  }

  // 2) Try bookingId / bookingRef
  if (bookingRef) {
    const byRef = await Booking.findOne({
      $or: [{ bookingId: bookingRef }, { bookingRef }],
    });
    if (byRef) return byRef;
  }

  return null;
};

const markAddonPaidIfMatching = (
  bookingDoc,
  { stage, invoiceId, hostedUrl, paymentIntentId }
) => {
  if (!bookingDoc || !Array.isArray(bookingDoc.addonPayments)) return;

  const normStage = normaliseStage(stage);

  // Prefer precise match by stored invoice id in metadata
  let idx = bookingDoc.addonPayments.findIndex((p) => {
    const metaInvoiceId = String(p?.metadata?.stripeInvoiceId || "").trim();
    if (invoiceId && metaInvoiceId && metaInvoiceId === invoiceId) return true;
    if (
      paymentIntentId &&
      String(p?.paymentIntentId || "").trim() === paymentIntentId
    )
      return true;
    if (hostedUrl && String(p?.checkoutUrl || "").trim() === hostedUrl)
      return true;
    return false;
  });

  // Fallback: match by stage (first unpaid)
  if (idx === -1 && normStage) {
    idx = bookingDoc.addonPayments.findIndex((p) => {
      const pStage = normaliseStage(p?.stage);
      const status = String(p?.status || "").toLowerCase();
      return pStage === normStage && status !== "paid";
    });
  }

  if (idx >= 0) {
    bookingDoc.addonPayments[idx] = {
      ...(bookingDoc.addonPayments[idx]?.toObject
        ? bookingDoc.addonPayments[idx].toObject()
        : bookingDoc.addonPayments[idx]),
      status: "paid",
      paidAt: new Date(),
      paymentIntentId:
        paymentIntentId ||
        bookingDoc.addonPayments[idx]?.paymentIntentId ||
        "",
      metadata: {
        ...(bookingDoc.addonPayments[idx]?.metadata || {}),
        stripeInvoiceId:
          invoiceId || bookingDoc.addonPayments[idx]?.metadata?.stripeInvoiceId,
      },
    };
  }
};

const applyPaidAmountToBooking = (bookingDoc, { amountPaidMajor, stage }) => {
  if (!bookingDoc) return;

  const stageNorm = normaliseStage(stage);

  const totals = bookingDoc.totals?.toObject
    ? bookingDoc.totals.toObject()
    : bookingDoc.totals || {};

  const fullAmount = safeNum(totals.fullAmount || bookingDoc.fee || 0);
  const prevCharged = safeNum(totals.chargedAmount ?? 0);

  const nextChargedRaw = prevCharged + safeNum(amountPaidMajor);
  const nextCharged =
    fullAmount > 0 ? Math.min(fullAmount, nextChargedRaw) : nextChargedRaw;

  const remaining =
    fullAmount > 0 ? Math.max(0, fullAmount - nextCharged) : 0;

  const isBalancePayment = stageNorm === "balance";
  const isNowPaid = isBalancePayment || remaining <= 0.01;

  bookingDoc.totals = {
    ...totals,
    fullAmount,
    chargedAmount: isNowPaid && fullAmount > 0 ? fullAmount : nextCharged,
    remainingAmount: isNowPaid ? 0 : remaining,
    outstandingBalance: isNowPaid ? 0 : remaining,
    balancePaid: isNowPaid,
  };

  bookingDoc.balanceAmountPence = isNowPaid ? 0 : Math.round(remaining * 100);
  bookingDoc.balancePaid = isNowPaid;
  bookingDoc.paymentStatus = isNowPaid ? "paid" : "unpaid";

  if (isNowPaid) {
    bookingDoc.balanceStatus = "paid";
  }
};

const upsertAccountingForPayment = (
  bookingDoc,
  { paymentStage, commissionGross, commissionVat, commissionNet, passThroughGross, vatRate }
) => {
  if (!bookingDoc) return;

  const current = bookingDoc.accounting?.toObject
    ? bookingDoc.accounting.toObject()
    : bookingDoc.accounting || {};

  bookingDoc.accounting = {
    ...current,
    paymentStage: paymentStage || current.paymentStage || "",
    vatRate: Number.isFinite(vatRate) ? vatRate : (Number.isFinite(current.vatRate) ? current.vatRate : 0.2),
    commissionGross: safeNum(commissionGross ?? current.commissionGross),
    commissionVat: safeNum(commissionVat ?? current.commissionVat),
    commissionNet: safeNum(commissionNet ?? current.commissionNet),
    passThroughGross: safeNum(passThroughGross ?? current.passThroughGross),
    currency: current.currency || "GBP",
  };
};

try {
  switch (event.type) {
    // ----------------------------------------------------
    // Main cart checkout (deposit OR full)
    // ----------------------------------------------------
    case "checkout.session.completed": {
      const session = event.data.object;

      // Prefer PaymentIntent metadata (you set booking_ref etc there)
      const piId = String(session.payment_intent || "");
      const pi = piId ? await stripe.paymentIntents.retrieve(piId) : null;

      const meta =
        pi?.metadata && Object.keys(pi.metadata).length
          ? pi.metadata
          : session.metadata || {};

      const booking = await findBookingByMeta(meta);
      if (!booking) break;

      const paidMajor = toMajor(session.amount_total ?? pi?.amount_received ?? 0);

      const stage = normaliseStage(
  meta.payment_stage ||
    meta.paymentStage ||
    meta.booking_mode ||
    session.metadata?.payment_stage ||
    session.metadata?.paymentStage ||
    session.metadata?.booking_mode ||
    meta.category ||
    session.metadata?.category ||
    ""
);

      const VAT_RATE = Number(process.env.TSC_VAT_RATE ?? 0.2);

      // These exist for your cart checkout because you set them in createCheckoutSession
      const commissionGross = safeNum(meta.commission_gross);
      const commissionVat = safeNum(meta.commission_vat);
      const commissionNet = safeNum(meta.commission_net);
      const passThroughGross = safeNum(meta.pass_through_gross);

      // Fallback if for some reason metadata is missing: treat as commission
      const computed =
        commissionGross > 0 || passThroughGross > 0
          ? { commissionGross, commissionVat, commissionNet, passThroughGross }
          : (() => {
              const { vat, net } = getVatSplitFromGross(paidMajor, VAT_RATE);
              return {
                commissionGross: paidMajor,
                commissionVat: vat,
                commissionNet: net,
                passThroughGross: 0,
              };
            })();

      booking.sessionId = booking.sessionId || String(session.id || "");
      booking.paymentIntentId = booking.paymentIntentId || piId || "";

      applyPaidAmountToBooking(booking, {
        amountPaidMajor: paidMajor,
        stage: stage === "full" ? "full" : "deposit",
      });

      upsertAccountingForPayment(booking, {
        paymentStage: stage === "full" ? "full" : "deposit",
        ...computed,
        vatRate: VAT_RATE,
      });

      // If they paid full at checkout, make sure balance shows paid
      if (stage === "full") {
        booking.balancePaid = true;
        booking.balanceStatus = "paid";
      }

      await booking.save();
      break;
    }

    // ----------------------------------------------------
    // Stripe Invoice flow (balance + invoice-based addons)
    // ----------------------------------------------------
    case "invoice.paid": {
      const invoice = event.data.object;
      const meta = invoice.metadata || {};

      const stage = normaliseStage(
        meta.stage || meta.paymentStage || meta.payment_stage || ""
      ); // "balance" | "addon_deposit" | "addon_full" | "deposit" | "full"

      const booking = await findBookingByMeta({
        bookingId: meta.bookingId || meta.booking_id || meta.booking_ref,
        booking_ref: meta.booking_ref,
        bookingMongoId: meta.bookingMongoId,
      });
      if (!booking) break;

      const paidMajor = toMajor(invoice.amount_paid ?? invoice.total ?? 0);
      const VAT_RATE = Number(process.env.TSC_VAT_RATE ?? 0.2);

      // Default rule for invoice-based payments:
      // - balance + addons are PASS-THROUGH by default
      // - if you later add commission metadata to invoices, it will honour it
      const explicitCommissionGross = safeNum(meta.commission_gross);
      const explicitPassThroughGross = safeNum(meta.pass_through_gross);

      const computed =
        explicitCommissionGross > 0 || explicitPassThroughGross > 0
          ? (() => {
              const { vat, net } = getVatSplitFromGross(explicitCommissionGross, VAT_RATE);
              return {
                commissionGross: explicitCommissionGross,
                commissionVat: vat,
                commissionNet: net,
                passThroughGross: explicitPassThroughGross,
              };
            })()
          : {
              commissionGross: 0,
              commissionVat: 0,
              commissionNet: 0,
              passThroughGross: paidMajor,
            };

      // Mark add-on entry as paid if relevant
      if (stage === "addon_deposit" || stage === "addon_full") {
        markAddonPaidIfMatching(booking, {
          stage,
          invoiceId: String(invoice.id || ""),
          hostedUrl: String(invoice.hosted_invoice_url || ""),
          paymentIntentId: String(invoice.payment_intent || ""),
        });
      }

     const paymentStage =
  stage === "balance" ? "balance" : stage === "full" ? "full" : "deposit";

applyPaidAmountToBooking(booking, {
  amountPaidMajor: paidMajor,
  stage: paymentStage,
});

upsertAccountingForPayment(booking, {
  paymentStage,
  ...computed,
  vatRate: VAT_RATE,
});

if (paymentStage === "full" || paymentStage === "balance") {
  booking.balancePaid = true;
  booking.balanceStatus = "paid";
  booking.balanceAmountPence = 0;
  booking.paymentStatus = "paid";

  booking.totals = {
    ...(booking.totals?.toObject ? booking.totals.toObject() : booking.totals || {}),
    remainingAmount: 0,
    outstandingBalance: 0,
    balancePaid: true,
  };
}

      await booking.save();
      break;
    }

    // Optional failure logging
    case "invoice.payment_failed":
    case "invoice.finalization_failed":
    case "checkout.session.async_payment_failed": {
      console.warn("⚠️ Stripe payment failure event:", {
        type: event.type,
        id: event?.data?.object?.id,
      });
      break;
    }

    default:
      break;
  }
} catch (handlerErr) {
  console.error("🔥 Stripe webhook handler error:", handlerErr?.message || handlerErr);
  // Still 200 so Stripe doesn't hammer retries while you debug.
}

    return res.status(200).json({ received: true });
  }
);

// JSON/body parsing (after webhook)
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

/* -------------------------------------------------------------------------- */
/*                         DB + Cloudinary boot/config                         */
/* -------------------------------------------------------------------------- */

connectDB();
connectCloudinary();

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_SECRET_KEY,
});

/* -------------------------------------------------------------------------- */
/*                 🌍 Global (optional) request timing middleware              */
/* -------------------------------------------------------------------------- */

app.use((req, res, next) => {
  // Skip noisy routes
  if (
    req.originalUrl.includes("/api/v2/travel/travel-data") ||
    req.originalUrl.includes("/api/availability/subscribe")
  ) {
    return next();
  }

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;

    // skip 304
    if (status === 304) return;

    // uncomment to log every request
    // console.log(`[${req.method}] ${status} ${req.originalUrl} (${duration}ms)`);
  });

  next();
});

/* -------------------------------------------------------------------------- */
/*                                   Debug                                    */
/* -------------------------------------------------------------------------- */

app.get("/debug/base", (_req, res) => {
  res.json({
    INTERNAL_BASE_URL: process.env.INTERNAL_BASE_URL || null,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL || null,
    BACKEND_URL: process.env.BACKEND_URL || null,
    time: new Date().toISOString(),
  });
});

app.get("/debug/routes", (_req, res) => {
  res.json(listEndpoints(app));
});

/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */


app.post("/api/admin/dedupe-selected-songs/run", async (req, res) => {
  try {
    console.log("[dedupeSelectedSongs] Manual run started");

    await dedupeSelectedSongsForAllMusicians();

    res.json({
      success: true,
      message: "Dedupe selected songs completed",
    });
  } catch (error) {
    console.error("[dedupeSelectedSongs] Manual run failed:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Dedupe failed",
    });
  }
});

// Extra logging around musician-login (only once)
app.use(
  "/api/musician-login",
  (req, _res, next) => {
    if (req.method !== "OPTIONS") {
      console.log("🎯 hit /api/musician-login", {
        method: req.method,
        origin: req.headers.origin,
      });
    }
    next();
  },
  musicianLoginRouter
);

app.use("/api/sitemap", sitemapRoutes);
app.use("/api/v2", v2Routes);
app.use("/api/agent-dashboard", agentDashboardRoutes);

app.use("/api/user", userRouter);
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRouter);
app.use("/api/musician", musicianRouter);

app.use("/api/act", actV2Routes);
app.use("/api/musician/act-v2", actV2Routes);

app.use("/api/availability", availabilityRoutes);

app.post(
  "/api/shortlist/twilio/inbound",
  express.urlencoded({ extended: false }),
  (req, res) => {
    console.log("🟡 Legacy Twilio alias hit", {
      from: req.body?.From,
      to: req.body?.To,
      body: req.body?.Body,
    });

    return twilioInbound(req, res);
  }
);

app.use("/api/shortlist", shortlistRoutes);
app.use("/api/board/enquiries", enquiryBoardRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/deputy-opportunities", deputyOpportunityRoutes);
app.use("/api/deputy-jobs", deputyJobRouter);

app.use("/api/cart", cartRouter);
app.use("/api/booking", bookingRoutes);
app.use("/api/payments", paymentsRouter);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/board/bookings", bookingBoardRoutes);

app.use("/api/newsletter", newsletterRoutes);
app.use("/api/noticeboard", noticeRoutes);
app.use("/api/feedback", feedbackRoutes);

app.use("/api/upload", uploadRoutes);

app.use("/api/google", googleRoutes);
app.use("/api/calendar", calendarWebhook);

app.use("/api/act-pre-submissions", actPreSubmissionRoutes);
app.use("/api/moderation", moderationRoutes);

app.use("/api/finance/bookings", bookingForecastRouter);
app.use("/api/finance/forecast", forecastRouter);
app.use("/api/finance/accounts", financeAccountRouter);
app.use("/api/finance/transactions", financeTransactionRouter);
app.use("/api/finance/forecast-events", forecastEventRouter);
app.use("/api/finance/recurring-rules", recurringForecastRuleRouter);
app.use("/api/finance/reconcile", financeReconciliationRouter);
app.use("/api/finance/tax", financeTaxRouter);
app.use("/api/finance/forecast", financeForecastRoutes);

app.use("/api/debug", debugRoutes);
app.use("/api/allocations", allocationRoutes);
app.use("/api", adminRoutes);

// Google webhooks (keep as-is)
app.post("/api/google/webhook", handleGoogleWebhook);
app.post("/api/google/notifications", handleGoogleWebhook);

// Twilio test endpoint
app.post(
  "/api/shortlist/wh",
  express.urlencoded({ extended: false }),
  (req, res) => {
    console.log("✅ Twilio inbound webhook hit /wh", {
      keys: Object.keys(req.body || {}),
      from: req.body?.From,
      to: req.body?.To,
      bodyPreview: String(req.body?.Body || "").slice(0, 160),
    });
    res.sendStatus(200);
  }
);

// Twilio status/inbound
app.post(
  "/api/twilio/inbound",
  express.urlencoded({ extended: false }),
  twilioInbound
);
app.post(
  "/api/twilio/status",
  express.urlencoded({ extended: false }),
  twilioStatus
);

// Availability direct mount
app.get("/api/availability/acts-available", async (req, res) => {
  const date = String(req.query?.date || "").slice(0, 10);
  console.log("🗓️  GET /api/availability/acts-available", { date });
  try {
    return await getAvailableActIds(req, res);
  } catch (err) {
    console.error("❌ acts-available failed:", err?.message || err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Health check
app.get("/", (_req, res) => {
  res.send("✅ API Working");
});

/* -------------------------------------------------------------------------- */
/*                            Global error handler                             */
/* -------------------------------------------------------------------------- */

app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err?.stack || err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server error",
  });
});

/* -------------------------------------------------------------------------- */
/*                          Cron & background jobs                             */
/* -------------------------------------------------------------------------- */

// Start reminders queue
startRemindersPoller({ intervalMs: 30000 });

startDedupeSelectedSongsCron();

// kick off a light poller every 2 minutes (no-op if nothing is due)
if (process.env.ENABLE_DEFERRED_AVAILABILITY !== "0") {
  setInterval(() => {
    processDueDeputyEscalations().catch((e) =>
      console.warn("[deferredAvailability] poller error:", e.message)
    );
  }, 2 * 60 * 1000);
}



// Manual route to process deferred availability
app.get("/api/availability/process-deferred", async (_req, res) => {
  try {
    const out = await processDueDeputyEscalations({ maxBatch: 50 });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Run chase & escalation every hour
cron.schedule("0 * * * *", async () => {
  await runChaseAndEscalation();
});

// Release deputy payouts daily at 06:00 London time
cron.schedule(
  "0 6 * * *",
  async () => {
    console.log("💸 [CRON] Running deputy payout release...");
    try {
      const result = await runDeputyPayoutRelease({ asOfDate: new Date() });
      console.log("✅ [CRON] Deputy payout release complete:", {
        checkedCount: result.checkedCount,
        releasedCount: result.releasedCount,
        totalReleased: result.totalReleased,
        financeEmailSent: Boolean(result.financeEmailResult?.success),
      });
    } catch (err) {
      console.error(
        "❌ [CRON] Deputy payout release failed:",
        err?.message || err
      );
    }
  },
  { timezone: "Europe/London" }
);

// Refresh availability badges every 30 minutes
cron.schedule("*/30 * * * *", async () => {
  console.log("🔁 [CRON] Refreshing availability badges...");
  try {
    const acts = await actModel
      .find({})
      .select("_id name tscName formattedAddress availabilityBadges lineups")
      .lean();

    for (const act of acts) {
      const dates = new Set(
        (Array.isArray(act.availabilityBadges)
          ? act.availabilityBadges.map((b) => b.dateISO)
          : [act.availabilityBadges?.dateISO]
        ).filter(Boolean)
      );

      for (const dateISO of dates) {
        const badge = await buildAvailabilityBadgeFromRows(act, dateISO);
        if (badge) {
          await actModel.updateOne(
            { _id: act._id },
            { $set: { [`availabilityBadges.${dateISO}`]: badge } }
          );
          console.log(
            `✅ Refreshed badge for ${act.tscName || act.name} (${dateISO})`
          );
        } else {
          console.log(
            `🪶 No badge data for ${act.tscName || act.name} (${dateISO})`
          );
        }
      }
    }

    console.log("🌙 [CRON] Badge refresh complete.");
  } catch (err) {
    console.error("❌ [CRON] Badge refresh failed:", err);
  }
});

// Re-register Google Calendar webhook daily at 03:00 UTC
let isRegistering = false;

cron.schedule("0 3 * * *", async () => {
  if (isRegistering) {
    console.log("⏸️ Skipping duplicate cron run (already refreshing)");
    return;
  }

  try {
    isRegistering = true;
    console.log("🔄 [CRON] Re-registering Google Calendar webhook...");
    const resWatch = await watchCalendar();
    console.log("✅ Webhook refreshed:", resWatch?.id || "(no id returned)");
  } catch (err) {
    console.error("❌ [CRON] Webhook refresh failed:", err.message);
  } finally {
    isRegistering = false;
  }
});

console.log(
  "🕒 Cron job scheduled: Google Calendar webhook will refresh daily at 03:00 UTC"
);
console.log(
  "🕒 Cron job scheduled: Deputy payouts will release daily at 06:00 Europe/London"
);

/* -------------------------------------------------------------------------- */
/*                                   Server                                   */
/* -------------------------------------------------------------------------- */

app.listen(port, () => console.log(`🚀 Server started on PORT: ${port}`));

// Auto-register Google Calendar watch channel at startup
(async () => {
  try {
    await watchCalendar();
    console.log("📡 Google Calendar watch channel started");
  } catch (err) {
    console.warn("⚠️ Could not start calendar watch:", err.message);
  }
})();