import axios from "axios";

/**
 * Fetch driving distance/duration between two postcodes.
 * Normalizes both new {outbound} and legacy {rows[0].elements[0]} shapes.
 */
export const getDrivingData = async (fromPostcode, toPostcode) => {
  try {
    const BASE = (
      import.meta.env.VITE_BACKEND_URL || "https://tsc-backend-v2.onrender.com"
    ).replace(/\/+$/, "");
    const url = `${BASE}/api/v2/travel/travel-data`;

    const params = {
      origin: fromPostcode,
      destination: toPostcode,
      date: new Date().toISOString().slice(0, 10),
    };

    const { data } = await axios.get(url, {
      params,
      headers: { accept: "application/json" },
      withCredentials: false,
    });

    // --- Normalize shapes (new or legacy)
    const legacy = data?.rows?.[0]?.elements?.[0] || {};
    const outbound = data?.outbound || legacy;

    const distanceMeters = outbound?.distance?.value ?? 0;
    const durationSeconds = outbound?.duration?.value ?? 0;
    const source =
      data?.sources?.outbound || (data?.outbound ? "v2" : "legacy");

    const distance = distanceMeters / 1609.34; // miles
    const duration = durationSeconds / 60; // minutes

    return {
      distance,
      duration,
      distanceMeters,
      durationSeconds,
      source,
    };
  } catch (error) {
    console.error("🚨 Error getting driving data:", error?.message || error);
    return {
      distance: 0,
      duration: 0,
      distanceMeters: 0,
      durationSeconds: 0,
      source: "error",
    };
  }
};