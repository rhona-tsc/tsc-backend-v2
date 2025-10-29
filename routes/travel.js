// frontend/src/pages/utils/travelV2.js
// Single, hardened helper used by the store + admin to fetch travel data
// Forces an ABSOLUTE backend base so calls never hit the Netlify origin.

export default async function getTravelV2(origin, destination, dateISO) {
  const startTime = performance.now();
  

  const BASE_RAW = "https://tsc-backend-v2.onrender.com";
  const BASE = String(BASE_RAW || "").replace(/\/+$/, "");


  const qs =
    `origin=${encodeURIComponent(origin || "")}` +
    `&destination=${encodeURIComponent(destination || "")}` +
    `&date=${encodeURIComponent((dateISO || "").slice(0, 10))}`;

  const url = `${BASE}/api/v2/travel/travel-data?${qs}`;

  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const text = await res.text();

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
    
      throw new Error("[travelV2] Non-JSON response");
    }

    if (!res.ok) {
      const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
   
      throw new Error(`[travelV2] ${res.status} ${msg}`);
    }

    // Normalize both the **new** shape and the Google Matrix legacy shape
    const firstEl = data?.rows?.[0]?.elements?.[0];
    const outbound =
      data?.outbound ||
      (firstEl?.distance && firstEl?.duration
        ? {
            distance: firstEl.distance,
            duration: firstEl.duration,
            fare: firstEl.fare,
          }
        : undefined);

    const returnTrip = data?.returnTrip;
    const miles =
      (outbound?.distance?.value != null ? outbound.distance.value : 0) /
      1609.34;

    const durationMs = (performance.now() - startTime).toFixed(0);
 

    return { outbound, returnTrip, miles, raw: data };
  } catch (err) {
  }  throw new Error(`[travelV2] Fetch error: ${err.message || err}`);
}