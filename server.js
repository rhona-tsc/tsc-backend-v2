// backend/server.js
import express from "express";
import cors from "cors";
import "dotenv/config";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cron from "node-cron";
import listEndpoints from "express-list-endpoints";
import connectDB from "./config/mongodb.js";
import connectCloudinary from "./config/connectCloudinary.js";
import cloudinary from "./config/cloudinary.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import noticeRoutes from "./routes/noticeRoutes.js";
import actPreSubmissionRoutes from "./routes/actPreSubmissionRoutes.js";
import shortlistRoutes from "./routes/shortlist.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import userRouter from "./routes/userRoute.js";
import musicianRouter from "./routes/musicianRoute.js";
import actV2Routes from "./routes/actV2Routes.js";
import actCardRoutes from "./routes/actCardRoutes.js";
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
import { runOnboardingChase } from "./cron/onboardingChase.js";
import adminRoutes from "./routes/admin.js";
import messageRoutes from "./routes/messageRoutes.js";
import deputyOpportunityRoutes from "./routes/deputyOpportunityRoutes.js";
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
import deputyJobRouter from "./routes/deputyJobRoute.js";

import { runDeputyPayoutRelease } from "./services/deputyPayoutService.js";


// Simple env debug
console.log("ENV CHECK:", {
  INTERNAL_BASE_URL: process.env.INTERNAL_BASE_URL,
  BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
  BACKEND_URL: process.env.BACKEND_URL,
});

const app = express();
const port = process.env.PORT || 4000;

/* -------------------------------------------------------------------------- */
/*                               CORS (VERY TOP)                              */
/* -------------------------------------------------------------------------- */

app.set("trust proxy", 1); // Render/Cloudflare

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
  "Content-Type, Authorization, token, Cache-Control, Pragma, X-Requested-With, x-request-id, Useremail, Userid, Userrole, useremail, userid, userrole";

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

// Main CORS middleware
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || isAllowedOrigin(origin)) {
        cb(null, true);
      } else {
        cb(new Error("CORS blocked"), false);
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ALLOW_HEADERS.split(",").map((h) => h.trim()),
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// Force headers on all responses (helps behind Cloudflare / proxies)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  res.setHeader("Vary", "Origin");
  next();
});

// Global preflight handler
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.header("Access-Control-Allow-Headers", ALLOW_HEADERS);
    res.header("Access-Control-Allow-Credentials", "true");
    return res.sendStatus(204);
  }
  next();
});


/* -------------------------------------------------------------------------- */
/*                          Standard app middleware                            */
/* -------------------------------------------------------------------------- */

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use(cookieParser());
app.use(express.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "100mb" }));
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
/*                 🌍 Global color-coded route logging middleware              */
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
  const color = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const method = req.method.padEnd(6);
    const status = res.statusCode;

    if (status === 304) return;

    let statusColor =
      status >= 500 ? color.red : status >= 400 ? color.yellow : color.green;

    // Uncomment if you want visible logs again:
    // console.log(
    //   `${statusColor}[${method}]${status}${color.reset} ${req.originalUrl} (${duration}ms)`
    // );
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


/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */

// Login API (with extra logging)
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



app.use("/api/agent-dashboard", agentDashboardRoutes);

// Twilio webhook test endpoint
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

app.post("/api/google/webhook", handleGoogleWebhook);
app.post("/api/google/notifications", handleGoogleWebhook);

// Legacy alias for old Twilio webhook
app.post(
  "/api/shortlist/twilio/inbound",
  express.urlencoded({ extended: false }),
  (req, res) => {
    console.log(
      "🟡 Legacy alias hit — forwarding to /api/availability/twilio/inbound"
    );
    req.url = "/api/availability/twilio/inbound";
    app.handle(req, res);
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

// Start reminders queue
startRemindersPoller({ intervalMs: 30000 });

/* -------------------------- Main API mounts (clean) ------------------------- */

app.use("/api/musician-login", musicianLoginRouter);
app.use("/api/sitemap", sitemapRoutes);
app.use("/api/v2", v2Routes);
app.use("/api/agent-dashboard", agentDashboardRoutes);

app.use("/api/user", userRouter);
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRouter);
app.use("/api/musician", musicianRouter);

app.use("/api/act", actCardRoutes);
app.use("/api/act", actV2Routes);
app.use("/api/musician/act-v2", actV2Routes);

app.use("/api/availability", availabilityRoutes);
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

app.use("/api/debug", debugRoutes);
app.use("/api/allocations", allocationRoutes);
app.use("/api", adminRoutes);

// Availability direct mount
app.get("/api/availability/acts-available", async (req, res) => {
  const date = String(req.query?.date || "").slice(0, 10);
  console.log("🗓️  GET /api/availability/acts-available", { date });
  try {
    const result = await getAvailableActIds(req, res);
    return result;
  } catch (err) {
    console.error("❌ acts-available failed:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
});

// Health check
app.get("/", (_req, res) => {
  res.send("✅ API Working");
});
app.use("/api/debug", debugRoutes);

app.get("/debug/routes", (_req, res) => {
  res.json(listEndpoints(app));
});
app.use("/api/allocations", allocationRoutes);
app.use("/api/payments", paymentsRouter);


// Upload & musician routes (duplicate kept for compatibility)
app.use("/api/upload", uploadRoutes);
app.use("/api", adminRoutes);
/* -------------------------------------------------------------------------- */
/*                            Global error handler                            */
/* -------------------------------------------------------------------------- */

app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err?.stack || err);
  if (res.headersSent) return;
  res
    .status(err.status || 500)
    .json({ success: false, message: err.message || "Server error" });
});

/* -------------------------------------------------------------------------- */
/*                          Cron & background jobs                            */
/* -------------------------------------------------------------------------- */

// kick off a light poller every 2 minutes (no-op if nothing is due)
if (process.env.ENABLE_DEFERRED_AVAILABILITY !== "0") {
  setInterval(() => {
    processDueDeputyEscalations().catch((e) =>
      console.warn("[deferredAvailability] poller error:", e.message)
    );
  }, 2 * 60 * 1000);
}

// Weekly onboarding chase: Mondays 10:00 London time
cron.schedule(
  "0 10 * * 1",
  async () => {
    try {
      const report = await runOnboardingChase({
        limit: 200,
        dryRun: false,
        includePending: false,   // only approved by default
        onlyVocalists: false,    // set true if you want just vocalists
      });

      console.log("✅ [CRON] Onboarding chase done:", {
        matched: report.matched,
        emailed: report.emailed,
        remindedSetPassword: report.remindedSetPassword,
        remindedLogin: report.remindedLogin,
        skippedComplete: report.skippedComplete,
        errors: report.errors,
      });
    } catch (e) {
      console.error("❌ [CRON] Onboarding chase failed:", e?.message || e);
    }
  },
  { timezone: "Europe/London" }
);

// routes
app.get("/api/availability/process-deferred", async (req, res) => {
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
      console.error("❌ [CRON] Deputy payout release failed:", err?.message || err);
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
console.log("🕒 Cron job scheduled: Deputy payouts will release daily at 06:00 Europe/London");

/* -------------------------------------------------------------------------- */
/*                                   Server                                   */
/* -------------------------------------------------------------------------- */

app.listen(port, () =>
  console.log(`🚀 Server started on PORT: ${port}`)
);

// Auto-register Google Calendar watch channel at startup
(async () => {
  try {
    await watchCalendar();
    console.log("📡 Google Calendar watch channel started");
  } catch (err) {
    console.warn("⚠️ Could not start calendar watch:", err.message);
  }
})();