import axios from 'axios';
import travelCache from '../models/distanceCacheModel.js';

// How long a cached entry is considered fresh (minutes)
const STALE_MINUTES = Number(process.env.TRAVEL_CACHE_STALE_MINUTES || 60 * 24 * 30); // default 30 days

function norm(val) {
  return String(val || '').trim().toUpperCase();
}

function isFresh(doc) {
  if (!doc) return false;
  const cutoff = Date.now() - STALE_MINUTES * 60 * 1000;
  return new Date(doc.lastUpdated).getTime() > cutoff;
}

export const getTravelData = async (req, res) => {
  try {
    const { origin, destination } = req.query;
    console.log(`🌍 Incoming travel data request: origin=${origin}, destination=${destination}`);

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Missing origin or destination' });
    }

    const from = norm(origin);
    const to = norm(destination);

    // 1) Try DB cache first for both legs
    let cachedOut = await travelCache.findOne({ from, to }).lean();
    let cachedBack = await travelCache.findOne({ from: to, to: from }).lean();

    let outboundSource = 'db';
    let returnSource = 'db';

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    // 2) Fetch outbound from Google if missing/stale
    if (!isFresh(cachedOut)) {
      if (!apiKey) return res.status(503).json({ error: 'Google API key not configured' });
      console.log('📡 Fetching OUTBOUND via Google Distance Matrix');
      const gmOut = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
        params: { origins: from, destinations: to, key: apiKey },
      });
      const el = gmOut.data?.rows?.[0]?.elements?.[0];
      if (!el || el.status !== 'OK') {
        return res.status(400).json({ error: 'No route found (outbound).' });
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
      outboundSource = 'google';
    }

    // 3) Fetch return leg from Google if missing/stale
    if (!isFresh(cachedBack)) {
      if (!apiKey) return res.status(503).json({ error: 'Google API key not configured' });
      console.log('📡 Fetching RETURN via Google Distance Matrix');
      const gmBack = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
        params: { origins: to, destinations: from, key: apiKey },
      });
      const el = gmBack.data?.rows?.[0]?.elements?.[0];
      if (!el || el.status !== 'OK') {
        return res.status(400).json({ error: 'No route found (return).' });
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
      returnSource = 'google';
    }

    // 4) Build response compatible with your frontend (outbound/returnTrip) + source flags
    const outbound = {
      distance: { text: `${(cachedOut.distanceKm || 0).toFixed(1)} km`, value: Math.round((cachedOut.distanceKm || 0) * 1000) },
      duration: { text: `${Math.round(cachedOut.durationMinutes || 0)} mins`, value: Math.round((cachedOut.durationMinutes || 0) * 60) },
      fare: null,
    };

    const returnTrip = {
      distance: { text: `${(cachedBack.distanceKm || 0).toFixed(1)} km`, value: Math.round((cachedBack.distanceKm || 0) * 1000) },
      duration: { text: `${Math.round(cachedBack.durationMinutes || 0)} mins`, value: Math.round((cachedBack.durationMinutes || 0) * 60) },
      fare: null,
    };

    const sources = { outbound: outboundSource, return: returnSource };

    console.log(`📝 Travel data: OUT=${sources.outbound}, RET=${sources.return}`);
    return res.json({ outbound, returnTrip, sources });
  } catch (err) {
    console.error('❌ Error in getTravelData:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};