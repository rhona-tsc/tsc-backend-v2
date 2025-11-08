export default async function getTravelV2(origin, destination, dateISO) {

  if (!origin || !destination || destination === "TBC") {
  console.warn("[travelV2] Skipping travel calc: missing or TBC destination");
  return { outbound: null, returnTrip: null, miles: 0, raw: {} };
}
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

    // ✅ Normalize both new & legacy shapes
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
    console.log(`🧭 [travelV2] Success ${miles.toFixed(1)}mi in ${durationMs}ms`);

    return { outbound, returnTrip, miles, raw: data };
  } catch (err) {
    console.warn("⚠️ [travelV2] Fetch failed:", err.message || err);
    throw new Error(`[travelV2] Fetch error: ${err.message || err}`);
  }
}