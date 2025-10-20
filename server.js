
// backend/server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import connectDB from './config/mongodb.js';
import connectCloudinary from './config/connectCloudinary.js';
import cloudinary from './config/cloudinary.js';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import router from "./routes/debugRoutes.js";
import boardBackfillRoutes from "./routes/boardBackfillRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import userRouter from './routes/userRoute.js';
import musicianRouter from './routes/musicianRoute.js';
import actV2Routes from './routes/actV2Routes.js';
import cartRouter from './routes/cartRoute.js';
import bookingRoutes from './routes/bookingRoutes.js';
import googleRoutes from './routes/google.js';
import calendarWebhook from './routes/calendarWebhook.js';
import authRoutes from './routes/authRoutes.js';
import moderationRoutes from "./routes/moderationRoutes.js";
import userRoute from './routes/userRoute.js';
import debugRoutes from "./routes/debug.js";
import { watchCalendar } from './controllers/googleController.js';
import musicianLoginRouter from './routes/musicianLoginRoute.js';
import allocationRoutes from "./routes/allocationRoutes.js";
import availabilityRoutes from './routes/availability.js';
import paymentsRouter from "./routes/payments.js";
import musicianRoutes from "./routes/musicianRoute.js";
import accountRouter from './routes/accountRoute.js';
import voiceIvr from "./routes/voiceIvr.js";
import bookingBoardRoutes from "./routes/bookingBoardRoutes.js";
import { startRemindersPoller } from "./services/remindersQueue.js";
import uploadRoutes from "./routes/upload.js";
import notificationsRoutes from "./routes/notifications.js";
import newsletterRoutes from './routes/newsletterRoutes.js';
import { getAvailableActIds } from './controllers/actAvailabilityController.js';
import mongoose from "mongoose";
import { submitActSubmission } from './controllers/actSubmissionController.js';
import v2Routes from "./routes/v2.js";
import { twilioInbound, twilioStatusHandler } from './controllers/availabilityController.js';
import { handleGoogleWebhook } from './controllers/googleController.js';

// at the top of backend/server.js (after dotenv)
console.log('ENV CHECK:', {
  INTERNAL_BASE_URL: process.env.INTERNAL_BASE_URL,
  BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL,
  BACKEND_URL: process.env.BACKEND_URL,
});

const app = express();
const port = process.env.PORT || 4000;

/* -------------------------------------------------------------------------- */
/*                                 CORS FIRST                                 */
/* -------------------------------------------------------------------------- */


// Host-based allowlist (safer than full-origin string matching)
const ALLOWED_HOSTS = new Set([
  'localhost:5173',
  'localhost:5174',
  'tsc2025.netlify.app',
  'meek-biscotti-8d5020.netlify.app', // preview site
  'tsc2025-admin-portal.netlify.app',
  'tsc-backend-v2.onrender.com',
  'www.thesupremecollective.co.uk',
  'api.thesupremecollective.co.uk',
]);

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow same-origin / curl
  try {
    const { host, protocol } = new URL(origin);
    if (!/^https?:$/.test(protocol)) return false;
    return (
      ALLOWED_HOSTS.has(host) ||
      host.endsWith('.netlify.app') || // allow other Netlify previews if needed
      host.includes('localhost')
    );
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, cb) {
    isAllowedOrigin(origin) ? cb(null, true) : cb(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'token', 'X-Requested-With', "x-eventsheet-client", "x-requested-with"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  // If Origin is whitelisted, cors() will already have set ACAO; we just ensure ACAC is present
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});
app.options('*', cors(corsOptions)); // generic preflight
app.options('/api/musician-login/*', cors(corsOptions), (_req, res) => res.sendStatus(204)); // explicit preflight for login

// Render/Cloudflare often sit behind proxies
app.set('trust proxy', 1);

// tiny debug and cache-variance
app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'OPTIONS') {
    console.log(`🌐 CORS: ${req.method} ${req.url} | origin=${req.headers.origin || 'n/a'}`);
  }
  const _end = res.end;
  res.end = function (...args) {
    const acao = res.getHeader('Access-Control-Allow-Origin');
    if (acao) console.log(`   ↳ ACAO sent: ${acao}`);
    _end.apply(this, args);
  };
  next();
});

app.get('/debug/base', (_req, res) => {
  res.json({
    INTERNAL_BASE_URL: process.env.INTERNAL_BASE_URL || null,
    BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL || null,
    BACKEND_URL: process.env.BACKEND_URL || null,
    time: new Date().toISOString(),
  });
});

/* -------------------------------------------------------------------------- */
/*                          Standard app middleware                            */
/* -------------------------------------------------------------------------- */

app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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
  const start = Date.now();

  // ANSI color helpers
  const color = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const method = req.method.padEnd(6);
    const status = res.statusCode;
    const time = new Date().toISOString();

    // Choose color based on status
    let statusColor =
      status >= 500
        ? color.red
        : status >= 400
        ? color.yellow
        : color.green;

    console.log(
      `${color.cyan}🚴 (server.js)${color.reset} [${method}] ${req.originalUrl} → ${statusColor}${status}${color.reset} (${duration}ms)`,
      {
        ip: req.ip,
        origin: req.headers.origin || "n/a",
        userAgent: req.headers["user-agent"] || "unknown",
        time,
      }
    );
  });

  next();
});

/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */

// Put musician-login behind the global CORS (already applied above)
app.use('/api/musician-login', (req, _res, next) => {
  if (req.method !== 'OPTIONS') {
    console.log('🎯 hit /api/musician-login', { method: req.method, origin: req.headers.origin });
  }
  next();
}, musicianLoginRouter);

app.use("/api/v2", v2Routes);
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

// Twilio generic status (kept for backwards compat)
app.post(
  "/api/shortlist/twilio/status",
  express.urlencoded({ extended: false }),
  twilioStatusHandler
);


app.post('/api/google/webhook', handleGoogleWebhook);

app.post('/api/google/notifications', handleGoogleWebhook);

// ✅ Legacy alias for old Twilio webhook
app.post(
  "/api/shortlist/twilio/inbound",
  express.urlencoded({ extended: false }),
  (req, res) => {
    console.log("🟡 Legacy alias hit — forwarding to /api/availability/twilio/inbound");
    req.url = "/api/availability/twilio/inbound"; // rewrite path
    app.handle(req, res); // forward internally
  }
);


// Temporary aliases so existing Twilio config keeps working
app.post("/api/twilio/inbound", express.urlencoded({ extended: false }), twilioInbound);
app.post("/api/twilio/status", express.urlencoded({ extended: false }), twilioStatusHandler);


startRemindersPoller({ intervalMs: 30000 }); // every 30s

// Main API mounts
app.use('/api/user', userRouter);
app.use("/api", userRoute);
app.use('/api/acts', userRouter);

app.use('/api/musician', musicianRouter);
app.use('/api/musician/act-v2', actV2Routes);

app.use('/api/cart', cartRouter);
app.use('/api/booking', bookingRoutes);

app.use('/api/google', googleRoutes);
app.use('/api/calendar', calendarWebhook);

app.use('/api/auth', authRoutes);
app.use("/api/moderation", moderationRoutes);

app.use('/api/act', userRoute);
app.use('/api/musician/trash-act', actV2Routes);
app.use('/api', actV2Routes);
app.use('/api/musician/account', accountRouter);
app.use('/api/account', accountRouter);

app.use("/voice", voiceIvr);
app.use("/api/board/bookings", bookingBoardRoutes);
app.use('/api', newsletterRoutes);
app.use("/debug", debugRoutes);
app.use("/api", boardBackfillRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use('/api/act-submission', submitActSubmission);

app.use('/api/availability', availabilityRoutes);

// Direct mount
app.get("/api/availability/acts-available", async (req, res) => {
  const date = String(req.query?.date || "").slice(0, 10);
  console.log("🗓️  GET /api/availability/acts-available", { date });
  try {
    const result = await getAvailableActIds(req, res);
    return result;
  } catch (err) {
    console.error("❌ acts-available failed:", err?.message || err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});







// Health check
app.get('/', (_req, res) => {
  res.send("✅ API Working");
});
app.use("/api/debug", debugRoutes);

// Google calendar webhook setup
app.get('/api/google/watch', async (_req, res) => {
  try {
    await watchCalendar();
    res.send('📡 Calendar webhook registered');
  } catch (err) {
    console.error('❌ Failed to register calendar watch:', err);
    res.status(500).send('Watch registration failed');
  }
});

app.use("/api/allocations", allocationRoutes);
app.use("/api/payments", paymentsRouter);
app.get("/debug/musician-id?email=shamyra@thesupremecollective.co.uk", router);

// Upload & musician routes (dup kept for compat)
app.use("/api/musician", musicianRoutes);
app.use("/api/upload", uploadRoutes);

/* -------------------------------------------------------------------------- */
/*                                   Server                                   */
/* -------------------------------------------------------------------------- */
// Global error handler (returns JSON)
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err?.stack || err);
  if (res.headersSent) return; // if headers already sent, let Express finish
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server error' });
});

// ---------------------------------------------------------------------------
// 🕒 Google Calendar auto-watch refresh (runs daily at 3am UTC)
// ---------------------------------------------------------------------------
import cron from 'node-cron';
import { buildBadgeFromAvailability } from './controllers/availabilityBadgesController.js';

let isRegistering = false;

cron.schedule('0 3 * * *', async () => {
  if (isRegistering) {
    console.log('⏸️ Skipping duplicate cron run (already refreshing)');
    return;
  }

  try {
    isRegistering = true;
    console.log('🔄 [CRON] Re-registering Google Calendar webhook...');
    const res = await watchCalendar();
    console.log('✅ Webhook refreshed:', res.id || '(no id returned)');
  } catch (err) {
    console.error('❌ [CRON] Webhook refresh failed:', err.message);
  } finally {
    isRegistering = false;
  }
});
console.log('🕒 Cron job scheduled: Google Calendar webhook will refresh daily at 03:00 UTC');

app.listen(port, () => console.log(`🚀 Server started on PORT: ${port}`));

cron.schedule("*/30 * * * *", async () => {
  console.log("🔁 [CRON] Refreshing availability badges...");
  try {
    const upcomingActs = await mongoose.model("Act").find({
      "availabilityBadges.active": true,
    }).select("_id availabilityBadges.dateISO");

    for (const act of upcomingActs) {
      const dateISO = act.availabilityBadges?.dateISO;
      if (!dateISO) continue;

      const badge = await buildBadgeFromAvailability(act._id, dateISO);
      if (badge) {
        await mongoose.model("Act").updateOne({ _id: act._id }, { $set: { availabilityBadges: badge } });
        console.log(`✅ Refreshed badge for ${act._id} (${badge.vocalistName})`);
      }
    }

    console.log("🌙 [CRON] Badge refresh complete.");
  } catch (err) {
    console.error("❌ [CRON] Badge refresh failed:", err);
  }
});

// Auto-register Google Calendar watch channel at server startup
(async () => {
  try {
    await watchCalendar();
    console.log('📡 Google Calendar watch channel started');
  } catch (err) {
    console.warn('⚠️ Could not start calendar watch:', err.message);
  }
})();