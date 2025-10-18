// backend/controllers/travelController.js
import axios from "axios";
import travelCache from "../models/distanceCacheModel.js";

// How long a cached entry is considered fresh (minutes)
const STALE_MINUTES = Number(process.env.TRAVEL_CACHE_STALE_MINUTES || 60 * 24 * 30); // default 30 days

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */
function norm(val) {
  console.log(`🚗 (controllers/travelController.js) norm called at`, new Date().toISOString(), { val });
  return String(val || "").trim().toUpperCase();
}

function isFresh(doc) {
  console.log(`🚗 (controllers/travelController.js) isFresh called at`, new Date().toISOString(), {
    docExists: !!doc,
    lastUpdated: doc?.lastUpdated,
  });
  if (!doc) return false;
  const cutoff = Date.now() - STALE_MINUTES * 60 * 1000;
  const fresh = new Date(doc.lastUpdated).getTime() > cutoff;
  console.log(`🚗 isFresh result`, { fresh });
  return fresh;
}

/* -------------------------------------------------------------------------- */
/*                               getTravelData                                */
/* -------------------------------------------------------------------------- */
export const getTravelData = async (req, res) => {
  console.log(`🚗 (controllers/travelController.js) getTravelData called at`, new Date().toISOString(), {
    query: req.query,
  });

  try {
    const { origin, destination } = req.query;
    console.log(`🚗 getTravelData request received`, { origin, destination });

    if (!origin || !destination) {
      console.warn(`🚗 getTravelData missing origin or destination`);
      return res.status(400).json({ error: "Missing origin or destination" });
    }

    const from = norm(origin);
    const to = norm(destination);
    console.log(`🚗 getTravelData normalized`, { from, to });

    // 1️⃣ Try DB cache first for both legs
    let cachedOut = await travelCache.findOne({ from, to }).lean();
    let cachedBack = await travelCache.findOne({ from: to, to: from }).lean();
    console.log(`🚗 getTravelData cache lookup complete`, {
      hasOutbound: !!cachedOut,
      hasReturn: !!cachedBack,
    });

    let outboundSource = "db";
    let returnSource = "db";
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    // 2️⃣ Fetch outbound from Google if missing/stale
    if (!isFresh(cachedOut)) {
      console.log(`🚗 getTravelData outbound cache stale or missing`);
      if (!apiKey) return res.status(503).json({ error: "Google API key not configured" });

      console.log("🚗📡 Fetching OUTBOUND via Google Distance Matrix");
      const gmOut = await axios.get(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
        { params: { origins: from, destinations: to, key: apiKey } }
      );

      const el = gmOut.data?.rows?.[0]?.elements?.[0];
      if (!el || el.status !== "OK") {
        console.warn(`🚗 No valid outbound route found`);
        return res.status(400).json({ error: "No route found (outbound)." });
      }

      const distanceMeters = el.distance?.value ?? 0;
      const durationSeconds = el.duration?.value ?? 0;

      await travelCache.findOneAndUpdate(
        { from, to },
        {
          from,
          to,
          distanceKm: distanceMeters / 1000,
          durationMinutes: durationSeconds / 60,
          lastUpdated: new Date(),
        },
        { upsert: true }
      );

      cachedOut = {
        from,
        to,
        distanceKm: distanceMeters / 1000,
        durationMinutes: durationSeconds / 60,
        lastUpdated: new Date(),
      };
      outboundSource = "google";
      console.log(`🚗 Outbound route saved to cache`, { from, to });
    }

    // 3️⃣ Fetch return leg if missing/stale
    if (!isFresh(cachedBack)) {
      console.log(`🚗 getTravelData return cache stale or missing`);
      if (!apiKey) return res.status(503).json({ error: "Google API key not configured" });

      console.log("🚗📡 Fetching RETURN via Google Distance Matrix");
      const gmBack = await axios.get(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
        { params: { origins: to, destinations: from, key: apiKey } }
      );

      const el = gmBack.data?.rows?.[0]?.elements?.[0];
      if (!el || el.status !== "OK") {
        console.warn(`🚗 No valid return route found`);
        return res.status(400).json({ error: "No route found (return)." });
      }

      const distanceMeters = el.distance?.value ?? 0;
      const durationSeconds = el.duration?.value ?? 0;

      await travelCache.findOneAndUpdate(
        { from: to, to: from },
        {
          from: to,
          to: from,
          distanceKm: distanceMeters / 1000,
          durationMinutes: durationSeconds / 60,
          lastUpdated: new Date(),
        },
        { upsert: true }
      );

      cachedBack = {
        from: to,
        to: from,
        distanceKm: distanceMeters / 1000,
        durationMinutes: durationSeconds / 60,
        lastUpdated: new Date(),
      };
      returnSource = "google";
      console.log(`🚗 Return route saved to cache`, { from: to, to: from });
    }

    // 4️⃣ Build response compatible with frontend
    const outbound = {
      distance: {
        text: `${(cachedOut.distanceKm || 0).toFixed(1)} km`,
        value: Math.round((cachedOut.distanceKm || 0) * 1000),
      },
      duration: {
        text: `${Math.round(cachedOut.durationMinutes || 0)} mins`,
        value: Math.round((cachedOut.durationMinutes || 0) * 60),
      },
      fare: null,
    };

    const returnTrip = {
      distance: {
        text: `${(cachedBack.distanceKm || 0).toFixed(1)} km`,
        value: Math.round((cachedBack.distanceKm || 0) * 1000),
      },
      duration: {
        text: `${Math.round(cachedBack.durationMinutes || 0)} mins`,
        value: Math.round((cachedBack.durationMinutes || 0) * 60),
      },
      fare: null,
    };

    const sources = { outbound: outboundSource, return: returnSource };
    console.log(`🚗 getTravelData completed successfully`, {
      outboundSource,
      returnSource,
      outboundDistanceKm: cachedOut.distanceKm,
      returnDistanceKm: cachedBack.distanceKm,
    });

    return res.json({ outbound, returnTrip, sources });
  } catch (err) {
    console.error(`🚗❌ (controllers/travelController.js) getTravelData error:`, err.message || err);
    res.status(500).json({ error: "Server error" });
  }
};