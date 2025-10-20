// ✅ routes/availability.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import Act from "../models/actModel.js";
import {
  twilioInbound,
  rebuildAndApplyAvailabilityBadge,
  clearavailabilityBadges,
} from "../controllers/availabilityController.js";
import { makeAvailabilityBroadcaster } from "../controllers/availabilityController.js";
import { applyFeaturedBadgeOnYesV3 } from "../controllers/applyFeaturedBadgeOnYesV2.js";
import { resolveAvailableMusician } from "../controllers/allocationController.js";
import { getUserShortlist } from "../controllers/shortlistController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 🟩 GET /check-latest                                                       */
/* -------------------------------------------------------------------------- */
router.get("/check-latest", async (req, res) => {
  console.log(
    `🟩 (routes/availability.js) /check-latest START at ${new Date().toISOString()}`,
    { actId: req.query?.actId, dateISO: req.query?.dateISO }
  );

  try {
    const { actId, dateISO } = req.query;
    if (!actId || !dateISO)
      return res.status(400).json({ latestReply: null });

    const doc = await AvailabilityModel.findOne({ actId, dateISO })
      .sort({ repliedAt: -1, updatedAt: -1, createdAt: -1 });

    const latestReply =
      doc?.reply ||
      (["declined", "cancelled"].includes(doc?.calendarStatus)
        ? "unavailable"
        : null);

    res.json({ latestReply: latestReply || null });
  } catch (e) {
    console.error("⚠️ (availability.js) check-latest error:", e.message);
    res.status(500).json({ latestReply: null });
  }
});

router.get("/user/:userId/shortlisted", (req, res, next) => {
  console.log(
    `🟢 (routes/availability.js) /user/:userId/shortlisted START at ${new Date().toISOString()}`,
    { userId: req.params.userId }
  );
  next();
}, getUserShortlist);

/* -------------------------------------------------------------------------- */
/* 🟨 POST /twilio/inbound                                                    */
/* -------------------------------------------------------------------------- */
router.post("/twilio/inbound", (req, res, next) => {
  console.log(
    `🟨 (routes/availability.js) /twilio/inbound START at ${new Date().toISOString()}`
  );
  next();
}, twilioInbound);

/* -------------------------------------------------------------------------- */
/* 🟦 POST /rebuild-availability-badge                                        */
/* -------------------------------------------------------------------------- */
router.post("/rebuild-availability-badge", (req, res, next) => {
  console.log(
    `🟦 (routes/availability.js) /rebuild-availability-badge START at ${new Date().toISOString()}`,
    { bodyKeys: Object.keys(req.body || {}) }
  );
  next();
}, applyFeaturedBadgeOnYesV3);

/* -------------------------------------------------------------------------- */
/* 🟧 POST /badges/rebuild                                                    */
/* -------------------------------------------------------------------------- */
router.post("/badges/rebuild", (req, res, next) => {
  console.log(
    `🟧 (routes/availability.js) /badges/rebuild START at ${new Date().toISOString()}`,
    { bodyKeys: Object.keys(req.body || {}) }
  );
  next();
}, rebuildAndApplyAvailabilityBadge);

/* -------------------------------------------------------------------------- */
/* 🟪 GET /resolve-musician                                                   */
/* -------------------------------------------------------------------------- */
router.get("/resolve-musician", (req, res, next) => {
  console.log(
    `🟪 (routes/availability.js) /resolve-musician START at ${new Date().toISOString()}`,
    { query: req.query }
  );
  next();
}, resolveAvailableMusician);

/* -------------------------------------------------------------------------- */
/* 🟫 POST /badge/clear (Google Decline Hook)                                 */
/* -------------------------------------------------------------------------- */
router.post("/badge/clear", (req, res, next) => {
  console.log(
    `🟫 (routes/availability.js) /badge/clear START at ${new Date().toISOString()}`,
    { body: req.body }
  );
  next();
}, clearavailabilityBadges);

/* -------------------------------------------------------------------------- */
/* 🔵 POST /google/notifications                                              */
/* -------------------------------------------------------------------------- */
router.post("/google/notifications", async (req, res) => {
  console.log(
    `🔵 (routes/availability.js) /google/notifications START at ${new Date().toISOString()}`,
    { body: req.body }
  );

  try {
    const { actId, action } = req.body || {};
    if (action === "declined" && actId) {
      await clearavailabilityBadges(
        { body: { actId } },
        {
          status: (c) => ({ json: (o) => res.status(c).json(o) }),
          json: (o) => res.json(o),
        }
      );
    } else {
      res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error("❌ (availability.js) google/notifications error", e);
    res.status(500).json({ ok: false });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔴 Live Subscribe (SSE for availability updates)                           */
/* -------------------------------------------------------------------------- */
const sseClients = new Set();

// --- Shared broadcaster for controllers ---
const broadcastAvailability = (payload) => {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  console.log(`📡 (availability.js) Broadcasting availability update at ${new Date().toISOString()}`, payload);
  for (const res of sseClients) {
    try { res.write(data); } catch (err) { console.warn("⚠️ SSE write failed:", err.message); }
  }
};

const availabilityNotify = makeAvailabilityBroadcaster(broadcastAvailability);
global.availabilityNotify = availabilityNotify;
console.log("🌍 (availability.js) availabilityNotify broadcaster initialized");

const sseNoCompression = (req, res, next) => {
  req.headers["x-no-compression"] = "1";
  next();
};

router.get("/subscribe", sseNoCompression, (req, res) => {
  console.log(
    `🔴 (routes/availability.js) /subscribe (SSE) START at ${new Date().toISOString()}`
  );

  const STATIC_ALLOWED = new Set(
    [
      process.env.FRONTEND_URL,
      "https://tsc2025.netlify.app",
      "https://www.thesupremecollective.co.uk",
      "https://thesupremecollective.co.uk",
      "http://localhost:5173",
      "http://localhost:5174",
      "https://meek-biscotti-8d5020.netlify.app",
    ].filter(Boolean)
  );
  const NETLIFY_RE = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i;
  const origin = req.headers.origin || "";
  const isAllowed =
    STATIC_ALLOWED.has(origin) || NETLIFY_RE.test(origin);

  if (!isAllowed) {
    console.warn("🚫 (availability.js) SSE origin blocked by CORS:", origin);
    return res.status(403).end();
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write("retry: 5000\n\n");
  res.write("event: open\n");
  res.write(`data: ${Date.now()}\n\n`);
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    res.write("event: ping\n");
    res.write(`data: ${Date.now()}\n\n`);
  }, 25000);

  sseClients.add(res);
  console.log(`👥 SSE clients: ${sseClients.size}`);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(
      `🔌 (availability.js) SSE client disconnected — total: ${sseClients.size}`
    );
    try {
      res.end();
    } catch {}
  });
});

export default router;