// frontend/src/pages/utils/travelV2.js
export default async function getTravelV2(origin, destination, dateISO) {
  const BASE_RAW =
    "https://tsc-backend-v2.onrender.com";
  const BASE = String(BASE_RAW || "").replace(/\/+$/, "");
  const url = `${BASE}/api/v2/travel/travel-data?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${encodeURIComponent((dateISO || "").slice(0,10))}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error("[travelV2] Non-JSON response: " + text.slice(0, 80)); }

  if (!res.ok) throw new Error(`[travelV2] ${res.status} ${data?.message || text}`);

  const el = data?.rows?.[0]?.elements?.[0];
  const outbound = data?.outbound || (el?.distance && el?.duration ? { distance: el.distance, duration: el.duration, fare: el.fare } : undefined);
  const returnTrip = data?.returnTrip;
  const miles = (outbound?.distance?.value || 0) / 1609.34;

  return { outbound, returnTrip, miles, raw: data };
}