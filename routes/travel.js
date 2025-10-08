// frontend/src/pages/utils/travelV2.js
// Single, hardened helper used by the store + admin to fetch travel data
// Forces an ABSOLUTE backend base so calls never hit the Netlify origin.

export default async function getTravelV2(origin, destination, dateISO) {
  // Pick a backend base in this priority:
  // 1) VITE_BACKEND_URL injected at build
  // 2) window.__BACKEND_URL__ set in index.html at runtime (optional)
  // 3) Render URL fallback (safe default for prod)
  const BASE_RAW =
    "https://tsc2025.onrender.com";

  const BASE = String(BASE_RAW || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(BASE)) {
    // If this ever triggers in prod, you know your env var is missing.
    console.warn(
      "[travelV2] VITE_BACKEND_URL not set (got:",
      BASE_RAW,
      ") — falling back to Render default."
    );
  }

  const qs =
    `origin=${encodeURIComponent(origin || "")}` +
    `&destination=${encodeURIComponent(destination || "")}` +
    `&date=${encodeURIComponent((dateISO || "").slice(0, 10))}`;

  const url = `${BASE}/api/v2/travel/travel-data?${qs}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  // Try to JSON-parse; if it looks like HTML (e.g. Netlify/ngrok error page), throw early
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("[travelV2] Non‑JSON response (possible proxy/redirect): " + text.slice(0, 80));
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
    throw new Error(`[travelV2] ${res.status} ${msg}`);
  }

  // Normalise both the **new** shape and the Google Matrix legacy shape
  const firstEl = data?.rows?.[0]?.elements?.[0];
  const outbound =
    data?.outbound ||
    (firstEl?.distance && firstEl?.duration
      ? { distance: firstEl.distance, duration: firstEl.duration, fare: firstEl.fare }
      : undefined);
  const returnTrip = data?.returnTrip;

  const miles =
    (outbound?.distance?.value != null ? outbound.distance.value : 0) / 1609.34;

  return { outbound, returnTrip, miles, raw: data };
}