// routes/google.js
import express from "express";
import axios from "axios";
import {
  getAuthUrl,
  oauth2Callback,
  getCalendarEvent,
} from "../controllers/googleController.js";
import EnquiryMessage from "../models/EnquiryMessage.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                            GET /auth-url                                   */
/* -------------------------------------------------------------------------- */
router.get("/auth-url", (req, res, next) => {
  console.log(`🌍 (routes/google.js) GET /api/google/auth-url called at`, new Date().toISOString(), {
    query: req.query,
  });
  next();
}, getAuthUrl);

/* -------------------------------------------------------------------------- */
/*                            GET /oauth2callback                             */
/* -------------------------------------------------------------------------- */
router.get("/oauth2callback", (req, res, next) => {
  console.log(`🌍 (routes/google.js) GET /api/google/oauth2callback called at`, new Date().toISOString(), {
    queryKeys: Object.keys(req.query || {}),
  });
  next();
}, oauth2Callback);

/* -------------------------------------------------------------------------- */
/*                         GETADDRESS.IO (Address)                  */
/* -------------------------------------------------------------------------- */

router.get("/address/lookup", async (req, res) => {
  try {
    console.log(`📮 (routes/google.js) GET /api/google/address/lookup`, {
      postcode: String(req.query.postcode || ""),
    });
    const postcodeRaw = String(req.query.postcode || "").trim();
    const postcode = postcodeRaw.replace(/\s+/g, " ").toUpperCase();

    if (!postcode) return res.status(400).json({ message: "postcode is required" });

    const key = process.env.GETADDRESS_API_KEY;
    if (!key) return res.status(500).json({ message: "GETADDRESS_API_KEY not set" });

    // getAddress.io: find addresses for postcode
    const url = `https://api.getaddress.io/find/${encodeURIComponent(postcode)}?api-key=${encodeURIComponent(key)}`;

    const { data } = await axios.get(url, { timeout: 8000 });

    // data.addresses is usually an array of comma-separated address strings
    return res.json({
      postcode: data.postcode || postcode,
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
    });
  } catch (err) {
  console.error("❌ getAddress lookup failed:", {
    status: err?.response?.status,
    data: err?.response?.data,
    message: err?.message,
  });

  const status = err?.response?.status || 500;
  const message =
    err?.response?.data?.Message ||
    err?.response?.data?.message ||
    err?.message ||
    "Lookup failed";

  return res.status(status).json({ message });
}
});

// Autocomplete: free-text term -> suggestion list (address + id)
router.get("/address/autocomplete", async (req, res) => {
  try {
    const termRaw = String(req.query.term || req.query.q || "").trim();
    const term = termRaw.replace(/\s+/g, " ");

    console.log(`📮 (routes/google.js) GET /api/google/address/autocomplete`, { term });

    if (!term || term.length < 3) {
      return res.json({ suggestions: [] });
    }

    const key = process.env.GETADDRESS_API_KEY;
    if (!key) return res.status(500).json({ message: "GETADDRESS_API_KEY not set" });
console.log("🔑 GETADDRESS_API_KEY check:", {
  exists: !!process.env.GETADDRESS_API_KEY,
  len: String(process.env.GETADDRESS_API_KEY || "").length,
  startsWith: String(process.env.GETADDRESS_API_KEY || "").slice(0, 6),
});
    // getAddress.io Autocomplete
    // Docs: https://documentation.getaddress.io/ (Autocomplete)
    const url = `https://api.getaddress.io/autocomplete/${encodeURIComponent(
      term
    )}?api-key=${encodeURIComponent(key)}&top=10&all=true&show-postcode=true`;

    const { data } = await axios.get(url, { timeout: 8000 });

    return res.json({
      suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
    });
  } catch (err) {
    const status = err?.response?.status || 500;
    const message =
      err?.response?.data?.Message ||
      err?.response?.data?.message ||
      err?.message ||
      "Autocomplete failed";
    return res.status(status).json({ message });
  }
});

// Resolve: suggestion id -> full address object (includes postcode + county)
router.get("/address/get", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();

    console.log(`📮 (routes/google.js) GET /api/google/address/get`, { id });

    if (!id) return res.status(400).json({ message: "id is required" });

    const key = process.env.GETADDRESS_API_KEY;
    if (!key) return res.status(500).json({ message: "GETADDRESS_API_KEY not set" });

    const url = `https://api.getaddress.io/get/${encodeURIComponent(id)}?api-key=${encodeURIComponent(key)}`;

    const { data } = await axios.get(url, { timeout: 8000 });

    // Return raw fields; frontend can format as needed
    return res.json(data || {});
  } catch (err) {
    const status = err?.response?.status || 500;
    const message =
      err?.response?.data?.Message ||
      err?.response?.data?.message ||
      err?.message ||
      "Get address failed";
    return res.status(status).json({ message });
  }
});

/* -------------------------------------------------------------------------- */
/*                            POST /webhook                                   */
/* -------------------------------------------------------------------------- */
router.post("/webhook", async (req, res) => {
  console.log(`🌍 (routes/google.js) POST /api/google/webhook called at`, new Date().toISOString(), {
    headers: Object.keys(req.headers || {}),
    bodyKeys: Object.keys(req.body || {}),
  });

  console.log("📬 Google Calendar webhook headers:", req.headers);
  console.log("📬 Google Calendar webhook body:", req.body);

  const resourceId = req.headers["x-goog-resource-id"];
  const channelId = req.headers["x-goog-channel-id"];
  const state = req.headers["x-goog-resource-state"];

  console.log("🔔 Webhook received:", { channelId, resourceId, state });

  try {
    const eventId = req.body.id || req.query.eventId;
    if (!eventId) {
      console.warn("⚠️ No eventId provided, cannot fetch event.");
      return res.sendStatus(200);
    }

    const event = await getCalendarEvent(eventId);

    console.log("📆 Refetched event:", {
      id: event.id,
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        status: a.responseStatus,
      })),
    });

    if (event.attendees && event.attendees.length > 0) {
      for (const attendee of event.attendees) {
        const { email, responseStatus } = attendee;

        const enquiry = await EnquiryMessage.findOneAndUpdate(
          { calendarEventId: event.id, "attendees.email": email },
          { $set: { "attendees.$.calendarStatus": responseStatus } },
          { new: true }
        );

        if (enquiry) {
          console.log(`✅ (routes/google.js) Updated DB for ${email} → calendarStatus=${responseStatus}`);
        } else {
          console.warn(`⚠️ (routes/google.js) No matching enquiry found for eventId=${event.id}, email=${email}`);
        }
      }
    }
  } catch (err) {
    console.error("❌ (routes/google.js) Error handling webhook:", err);
  }

  res.sendStatus(200);
});

export default router;