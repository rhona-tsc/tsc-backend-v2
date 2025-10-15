import fetch from "node-fetch"; // if you don't already have global fetch
import { postcodes } from "../utils/postcodes.js";

const normalizeCounty = (c) => String(c || "").toLowerCase().trim();

// Build OUT->County map once from your postcodes file (array with a single root object)
let OUT_TO_COUNTY; // Map like { "SL6" => "Berkshire" }
const titleCase = (s="") => String(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/_/g, " ");
function ensureOutToCounty() {
  if (OUT_TO_COUNTY) return;
  OUT_TO_COUNTY = new Map();
  const root = Array.isArray(postcodes) ? (postcodes[0] || {}) : postcodes || {};
  for (const [countyKey, outs] of Object.entries(root)) {
    const countyName = titleCase(countyKey);
    if (!Array.isArray(outs)) continue;
    for (const oc of outs) {
      OUT_TO_COUNTY.set(String(oc).toUpperCase().trim(), countyName);
    }
  }
}

// More lenient postcode extraction (handles "SL6 8HN UK" or missing commas)
// --- Replace your extractOutcode and countyFromOutcode with these robust versions ---

const extractOutcode = (addr) => {
  const s = typeof addr === "string"
    ? addr
    : (addr?.postcode || addr?.address || "");
  const cleaned = String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // First, match the outward part of any UK postcode
  const m = cleaned.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/);
  if (m && m[1]) return m[1].trim();

  // If not found, fallback to any pattern like "SL6" or "SL"
  const m2 = cleaned.match(/\b([A-Z]{1,2}\d{1,2})\b/);
  return m2 ? m2[1].trim() : "";
};

const countyFromOutcode = (outcode, address = "") => {
  ensureOutToCounty();
  if (outcode) {
    const OUT = String(outcode).toUpperCase().trim();
    const county = OUT_TO_COUNTY.get(OUT);
    if (county) return county;
  }

  // 🔁 Fallbacks by name or fragment
  const addr = String(address).toLowerCase();
  if (addr.includes("maidenhead") || addr.includes("sl6") || addr.includes("berkshire"))
    return "Berkshire";
  if (addr.includes("london")) return "Greater London";
  if (addr.includes("essex")) return "Essex";
  if (addr.includes("oxfordshire") || addr.includes("ox")) return "Oxfordshire";

  return "";
};

// Fetch your existing travel service (the one FE calls)
// Prefer internal base for server-to-server calls, then fall back to public
async function getTravelData(originPostcode, destination, dateISO) {
  const qs = new URLSearchParams({
    origin: originPostcode,
    destination,
    date: dateISO,
  }).toString();

  const BASE = (
    process.env.INTERNAL_BASE_URL ||   // e.g. http://localhost:4000 or internal service URL
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    "https://tsc-backend-v2.onrender.com"
  ).replace(/\/+$/, "");

  // ✅ use the v2 route
  const url = `${BASE}/api/v2/travel?${qs}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}

  if (!res.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
    throw new Error(`travel ${res.status} - ${msg}`);
  }

  // --- Normalize shapes so callers can always use `.outbound` ---
  const firstEl = data?.rows?.[0]?.elements?.[0]; // legacy shape
  const outbound =
    data?.outbound ||
    (firstEl?.distance && firstEl?.duration
      ? { distance: firstEl.distance, duration: firstEl.duration, fare: firstEl.fare }
      : undefined);

  const returnTrip = data?.returnTrip;

  return { outbound, returnTrip, raw: data };
}



/**
 * Compute the **per-musician** message rate:
 *   base (member.fee or per-head from lineup) + TRAVEL
 * TRAVEL:
 *   - useCountyTravelFee → county fee per member
 *   - else if costPerMile → outbound miles * costPerMile * 25
 *   (mirrors your FE pricing path used only for messaging)
 */
async function computeMemberMessageFee({ act, lineup, member, address, dateISO, outcode }) {
  // --- base ---
  console.log("🧩 DEBUG county detect", { address, outcode: oc, county });
  let base = 0;
  const explicit = Number(member?.fee ?? 0);
  if (explicit > 0) {
    base = Math.ceil(explicit);
  } else {
    const county = countyFromOutcode(outcode, address);
    const total = Number(lineup?.base_fee?.[0]?.total_fee ?? act?.base_fee?.[0]?.total_fee ?? 0);
    const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
    const performers = members.filter(m => {
      const r = String(m?.instrument || "").toLowerCase();
      return r && r !== "manager" && r !== "admin";
    }).length || 1;
    base = total > 0 ? Math.ceil(total / performers) : 0;
  }

  // --- travel ---
  let travel = 0;

  // county path
  if (act?.useCountyTravelFee) {
    const oc = extractOutcode(address);
    const county = countyFromOutcode(oc, address); // ✅ pass address here too
    const perMember = getCountyFeeFromMap(act?.countyFees, county);
    if (perMember > 0) {
      travel = perMember;
    }
  }

  // cost-per-mile path (only if no county fee applied)
  if (!travel && Number(act?.costPerMile) > 0 && member?.postCode && address) {
    try {
      const dest = typeof address === "string" ? address : (address?.postcode || address?.address || "");
      const t = await getTravelData(member.postCode, dest, dateISO);
      const distanceMeters = t?.outbound?.distance?.value || 0;
      const miles = distanceMeters / 1609.34;
      travel = (miles || 0) * Number(act.costPerMile) * 25;
    } catch (e) {
      // swallow; leave travel = 0
    }
  }

  const total = Math.ceil(Math.max(0, base + travel));
  return total; // return NET per-musician message rate
}

// --- diagnostic check ---
console.log("🧩 Outcode test:", extractOutcode("Maidenhead SL6 8HN"));
console.log("🌍 County from SL6:", countyFromOutcode("SL6"));

export { computeMemberMessageFee, getTravelData, extractOutcode, countyFromOutcode, getCountyFeeFromMap };