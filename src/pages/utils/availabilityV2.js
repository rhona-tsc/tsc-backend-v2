// frontend/src/pages/utils/availabilityV2.js
import { BACKEND } from "../../apiBase";

export async function fetchActsByDateV2(dateISO) {
  const d = String(dateISO || "").slice(0,10);
  if (!d) return { map: {}, availableActIds: [], unavailableActIds: [] };

  const url = `${BACKEND}/api/v2/availability/acts-by-dateV2?date=${encodeURIComponent(d)}`;
  const r = await fetch(url, { headers: { accept: "application/json" }, credentials: "omit" });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) throw new Error(j?.message || text || `HTTP ${r.status}`);

  const availableActIds   = Array.isArray(j.availableActIds)   ? j.availableActIds   : [];
  const unavailableActIds = Array.isArray(j.unavailableActIds) ? j.unavailableActIds : [];
  const map = {};
  unavailableActIds.forEach(id => { map[id] = false; });
  availableActIds.forEach(id   => { if (!(id in map)) map[id] = true; });
  return { map, availableActIds, unavailableActIds };
}