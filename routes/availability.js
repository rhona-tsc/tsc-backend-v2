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
  ensureVocalistAvailabilityForLineup,
} from "../controllers/availabilityController.js";
import { makeAvailabilityBroadcaster } from "../controllers/availabilityController.js";
import { applyFeaturedBadgeOnYesV3 } from "../controllers/applyFeaturedBadgeOnYesV2.js";
import { resolveAvailableMusician } from "../controllers/allocationController.js";
import { getUserShortlist } from "../controllers/shortlistController.js";
import { getAvailabilityBadge } from "../controllers/availabilityController.js";
import User from "../models/userModel.js";

const router = express.Router();


// ---------------------- helpers for availability routes ----------------------
const toISODateOnlySafe = (v) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
  const d = new Date(v);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
};

const normalizeAvailabilityBody = (body = {}) => {
  const actId = body.actId || body.act_id || body.act?._id || body.act?.id || null;
  const lineupId =
    body.lineupId || body.lineup_id || body.lineup?._id || body.lineup?.id || null;

  const dateISO =
    toISODateOnlySafe(body.dateISO) ||
    toISODateOnlySafe(body.date) ||
    toISODateOnlySafe(body.selectedDate) ||
    null;

  const formattedAddress =
    (body.formattedAddress || body.address || body.selectedAddress || "").trim();

  const clientEmail = (body.clientEmail || body.email || "").trim().toLowerCase();
  const clientName = (body.clientName || body.name || "").trim();

  const enquiryId =
    body.enquiryId ||
    body.shortlistId ||
    body.requestId ||
    body.parentKey ||
    null;

  const enquiryRef = (body.enquiryRef || "").trim();

  const slotIndex =
    typeof body.slotIndex === "number"
      ? body.slotIndex
      : typeof body.slotIndex === "string" && body.slotIndex !== ""
      ? Number(body.slotIndex)
      : undefined;

  const userId =
    body.userId || body.user?._id || body.user?.id || body.userIdFromToken || undefined;

  const incrementShortlist =
    typeof body.incrementShortlist === "boolean" ? body.incrementShortlist : true;

  return {
    actId,
    lineupId: lineupId || undefined,
    dateISO,
    formattedAddress,
    address: formattedAddress, // keep both for backwards compatibility
    clientEmail,
    clientName,
    enquiryId,
    enquiryRef: enquiryRef || undefined,
    slotIndex: Number.isFinite(slotIndex) ? slotIndex : undefined,
    userId,
    incrementShortlist,
    // keep any extra fields passed in (e.g. skipDuplicateCheck, source)
    ...body,
  };
};

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
/* 🟢 POST /request – Trigger WhatsApp availability check (+ shortlist inc)   */
/* -------------------------------------------------------------------------- */
router.post("/request", async (req, res) => {
  console.log(
    `🟢 (availability.js) /request START at ${new Date().toISOString()}`,
    { bodyKeys: Object.keys(req.body || {}) }
  );

  try {
    const payload = normalizeAvailabilityBody(req.body || {});

    if (!payload.actId || !payload.dateISO) {
      return res
        .status(400)
        .json({ success: false, message: "Missing actId/dateISO" });
    }

    const result = await triggerAvailabilityRequest(payload);

    if (!result?.success) {
      console.warn("⚠️ /request triggerAvailabilityRequest failed", result);
      return res.status(500).json({
        success: false,
        message: result?.error || "Availability request failed",
        result,
      });
    }

    // ✅ increment timesShortlisted if desired (defaults true)
    if (payload.incrementShortlist) {
      try {
        await Act.findByIdAndUpdate(payload.actId, { $inc: { timesShortlisted: 1 } });
      } catch (e) {
        console.warn("⚠️ /request could not increment timesShortlisted:", e?.message);
      }
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error("❌ (availability.js) /request error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// routes/availabilityRoutes.js (or wherever)
router.post("/ensure-vocalists", ensureVocalistAvailabilityForLineup);

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

    // 🧮 Increment numberOfShortlistsIn
    const updated = await Act.findByIdAndUpdate(
      actId,
      { $inc: { numberOfShortlistsIn: 1 } },
      { new: true }
    ).select("_id name tscName numberOfShortlistsIn");


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
  try {
    const actId = req.params.id;
    if (!actId) return res.status(400).json({ success: false, message: "Missing actId" });

    const updated = await Act.findOneAndUpdate(
      { _id: actId },
      [
        {
          $set: {
            numberOfShortlistsIn: {
              $max: [0, { $subtract: ["$numberOfShortlistsIn", 1] }],
            },
          },
        },
      ],
      { new: true }
    ).select("_id name tscName numberOfShortlistsIn");

    res.json({ success: true, act: updated });
  } catch (err) {
    console.error("❌ decrement-shortlist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* 🟣 POST /request-on-behalf – Admin/agent trigger (manual enquiry etc.)     */
/* -------------------------------------------------------------------------- */
router.post("/request-on-behalf", async (req, res) => {
  console.log(
    `🟣 (availability.js) /request-on-behalf START at ${new Date().toISOString()}`,
    { bodyKeys: Object.keys(req.body || {}) }
  );

  try {
    const payload = normalizeAvailabilityBody(req.body || {});

    if (!payload.actId || !payload.dateISO) {
      return res
        .status(400)
        .json({ success: false, message: "Missing actId/dateISO" });
    }
    if (!payload.formattedAddress) {
      return res
        .status(400)
        .json({ success: false, message: "Missing formattedAddress/address" });
    }
    if (!payload.clientEmail) {
      return res
        .status(400)
        .json({ success: false, message: "Missing clientEmail" });
    }

    // Call your controller as INTERNAL helper (no Express res),
    // so we can also do extra stuff (like increment shortlist) here safely.
    const result = await triggerAvailabilityRequest(payload);

    if (!result?.success) {
      console.warn("⚠️ /request-on-behalf triggerAvailabilityRequest failed", result);
      return res.status(500).json({
        success: false,
        message: result?.error || "Availability request failed",
        result,
      });
    }

    // Optional: increment shortlist counter on the act (defaults to true)
    if (payload.incrementShortlist) {
      try {
        await Act.findByIdAndUpdate(payload.actId, { $inc: { timesShortlisted: 1 } });
      } catch (e) {
        console.warn("⚠️ /request-on-behalf could not increment timesShortlisted:", e?.message);
      }
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error("❌ (availability.js) /request-on-behalf error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});



export default router;