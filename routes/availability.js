// ✅ routes/availability.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import Act from "../models/actModel.js";
import {
  twilioInbound,
  rebuildAndApplyAvailabilityBadge,
  clearavailabilityBadges,
  triggerAvailabilityRequest,
  twilioStatus,
} from "../controllers/availabilityController.js";
import { makeAvailabilityBroadcaster } from "../controllers/availabilityController.js";
import { applyFeaturedBadgeOnYesV3 } from "../controllers/applyFeaturedBadgeOnYesV2.js";
import { resolveAvailableMusician } from "../controllers/allocationController.js";
import { getUserShortlist } from "../controllers/shortlistController.js";
import { getAvailabilityBadge } from "../controllers/availabilityController.js";
import User from "../models/userModel.js";

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

// In your router:
router.post("/api/twilio/status", twilioStatus);    // handles delivery/read/fail

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
/* 🟦 GET /badge/:actId/:dateISO – fetch a single badge for an act/date        */
/* -------------------------------------------------------------------------- */

router.get("/badge/:actId/:dateISO", async (req, res, next) => {
  console.log(
    `🟦 (routes/availability.js) /badge/:actId/:dateISO START at ${new Date().toISOString()}`,
    { params: req.params }
  );
  next();
}, getAvailabilityBadge);

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

  // Some dev proxies (e.g., Vite) drop the Origin header for same-origin proxied requests.
  const originHeader = req.headers.origin || "";
  const refererHeader = req.headers.referer || req.headers.referrer || "";
  const refererOrigin = (() => {
    try {
      return refererHeader ? new URL(refererHeader).origin : "";
    } catch {
      return "";
    }
  })();

  // Prefer Origin; fall back to Referer; if both missing and we're on localhost, allow.
  const resolvedOrigin = originHeader || refererOrigin;
  const allowWhenNoOrigin =
    !resolvedOrigin &&
    (req.hostname === "localhost" || req.hostname === "127.0.0.1");

  const isAllowed =
    allowWhenNoOrigin ||
    STATIC_ALLOWED.has(resolvedOrigin) ||
    NETLIFY_RE.test(resolvedOrigin);

  console.log("🔐 (availability.js) SSE CORS check", {
    originHeader,
    refererHeader,
    refererOrigin,
    resolvedOrigin,
    host: req.hostname,
    allowed: isAllowed,
  });

  if (!isAllowed) {
    console.warn("🚫 (availability.js) SSE origin blocked by CORS:", {
      originHeader,
      refererHeader,
    });
    return res.status(403).end();
  }

  // If no origin could be resolved (same-host dev), use '*'; otherwise echo the origin.
  res.setHeader("Access-Control-Allow-Origin", resolvedOrigin || "*");
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

/* -------------------------------------------------------------------------- */
/* 🟢 POST /request – Trigger WhatsApp availability check                     */
/* -------------------------------------------------------------------------- */

router.post("/request", async (req, res) => {
  console.log(`🟢 (availability.js) /request START at ${new Date().toISOString()}`, req.body);

  try {
   const {
  actId,
  date,
  address,
  selectedDate,
  selectedAddress,
} = req.body;

const finalDate = date || selectedDate;
const finalAddress = address || selectedAddress;

if (!actId || !finalDate) {
  return res.status(400).json({ success: false, message: "Missing actId/date" });
}

console.log(`📅 Availability request triggered for act=${actId} on ${finalDate}`);

const fakeReq = { body: { actId, date: finalDate, address: finalAddress } };
    const fakeRes = {
      status: (code) => ({
        json: (obj) => ({ code, ...obj }),
      }),
      json: (obj) => obj,
    };

    const result = await triggerAvailabilityRequest(fakeReq, fakeRes);

    if (result?.success) {
      console.log(`✅ WhatsApp message sent successfully`, result);
      return res.json({ success: true, message: "WhatsApp request sent", result });
    } else {
      console.warn(`⚠️ WhatsApp send failed`, result);
      return res.status(500).json({ success: false, message: "WhatsApp send failed" });
    }

  } catch (err) {
    console.error("❌ (availability.js) /request error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* 🟡 PATCH /act/:id/increment-shortlist – increment shortlist counter        */
/* -------------------------------------------------------------------------- */

router.patch("/act/:id/increment-shortlist", async (req, res) => {

  const { userId, clientEmail, clientName } = req.body;
// ✅ Always prefer DB lookup if userId is provided
let email = clientEmail;
let name = clientName;

if (userId) {
  try {
    const user = await User.findById(userId).select("email firstName surname").lean();
    if (user) {
      email = user.email || email || "hello@thesupremecollective.co.uk";
      name = user.firstName || name || "there";
  
    } else {
      console.warn(`⚠️ No user found for ID: ${userId}`);
    }
  } catch (err) {
    console.warn("⚠️ Failed to enrich user from DB:", err.message);
  }
}


  if (!email) {
    console.warn("⚠️ Missing client email for shortlist increment, using fallback");
    email = "hello@thesupremecollective.co.uk";
  }

  if (!name) name = "there";


  try {
    const actId = req.params.id;
    if (!actId)
      return res.status(400).json({ success: false, message: "Missing actId" });

    // 🧮 Increment timesShortlisted
    const updated = await Act.findByIdAndUpdate(
      actId,
      { $inc: { timesShortlisted: 1 } },
      { new: true }
    ).select("_id name tscName timesShortlisted");


   // 🟢 Trigger WhatsApp availability request (non-blocking)
try {
 const { selectedDate, selectedAddress } = req.body || {};
  const actId = req.params.id;
  const dateISO = selectedDate || new Date().toISOString().slice(0, 10);
  const address = selectedAddress || "TBC";
const enquiryId = `${actId}_${dateISO}_${address}`.replace(/\s+/g, "_");



 await triggerAvailabilityRequest({
  actId,
  enquiryId,
    dateISO,       
  address,
  formattedAddress: address,
  clientEmail: email,
 clientName: name,
 userId,
});

  console.log("✅ Availability request triggered successfully");
} catch (whErr) {
  console.warn("⚠️ WhatsApp availability request failed:", whErr.message);
}

    // 🩵 Respond to client
    res.json({ success: true, act: updated });
  } catch (err) {
    console.error("❌ increment-shortlist error:", err);
    res
      .status(500)
      .json({ success: false, message: err.message });
  }
});


/* -------------------------------------------------------------------------- */
/* 🔵 PATCH /act/:id/decrement-shortlist – decrement shortlist counter        */
/* -------------------------------------------------------------------------- */
router.patch("/act/:id/decrement-shortlist", async (req, res) => {
  console.log(`🔵 (availability.js) /act/:id/decrement-shortlist START`, {
    id: req.params.id,
    userId: req.body?.userId,
  });

  try {
    const actId = req.params.id;
    if (!actId) return res.status(400).json({ success: false, message: "Missing actId" });

    const updated = await Act.findByIdAndUpdate(
      actId,
      { $inc: { timesShortlisted: -1 } },
      { new: true }
    ).select("_id name tscName timesShortlisted");

    res.json({ success: true, act: updated });
  } catch (err) {
    console.error("❌ decrement-shortlist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});



export default router;