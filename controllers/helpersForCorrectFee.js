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

// Extract outward code (e.g. "SL6")
const extractOutcode = (addr) => {
  const s = typeof addr === "string" ? addr : (addr?.postcode || addr?.address || "");
  const m = String(s || "")
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b|\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/);
  return (m && (m[1] || m[2])) ? (m[1] || m[2]) : "";
};

// Resolve county from outcode using your `postcodes` table
const countyFromOutcode = (outcode) => {
  if (!outcode) return "";
  ensureOutToCounty();
  const OUT = String(outcode).toUpperCase().trim();
  return OUT_TO_COUNTY.get(OUT) || "";
};

// Case-insensitive lookup from the act’s countyFees (object or Map)
const getCountyFeeFromMap = (feesMap, countyName) => {
  if (!feesMap || !countyName) return 0;
  const target = normalizeCounty(countyName);
  const iter = typeof feesMap.forEach === "function"
    ? (() => { const arr=[]; feesMap.forEach((v,k)=>arr.push([k,v])); return arr; })()
    : Object.entries(feesMap);
  for (const [k, v] of iter) {
    if (normalizeCounty(k) === target) return Number(v) || 0;
  }
  return 0;
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
 async function computeMemberMessageFee({ act, lineup, member, address, dateISO }) {
  if (!member || !lineup) return 0;

  // --- 1️⃣ Find the full member record in the lineup ---
  const fullMember = lineup.bandMembers?.find(m =>
    m._id?.toString() === member._id?.toString() ||
    m.email?.toLowerCase() === member.email?.toLowerCase() ||
    m.phoneNumber?.replace(/\s+/g, "") === member.phoneNumber?.replace(/\s+/g, "")
  );

  if (!fullMember) {
    console.warn("⚠️ Member not found in lineup for fee calculation:", member?.firstName);
  }

  // --- 2️⃣ Base fee ---
  const base = Number(fullMember?.fee ?? member?.fee ?? 0);

  // --- 3️⃣ Add essential additional roles ---
  const essentialExtras = (fullMember?.additionalRoles || [])
    .filter(r => r.isEssential)
    .reduce((sum, r) => sum + Number(r.additionalFee || 0), 0);

  // --- 4️⃣ Travel fee (keep your existing logic) ---
  let travel = 0;

  // County-based travel
  if (act?.useCountyTravelFee) {
    const outcode = extractOutcode(address);
    const county = countyFromOutcode(outcode);
    const perMember = getCountyFeeFromMap(act?.countyFees, county);
    if (perMember > 0) {
      travel = perMember;
    }
  }

  // Cost-per-mile travel (only if no county fee)
  if (!travel && Number(act?.costPerMile) > 0 && fullMember?.postCode && address) {
    try {
      const dest = typeof address === "string"
        ? address
        : (address?.postcode || address?.address || "");
      const t = await getTravelData(fullMember.postCode, dest, dateISO);
      const distanceMeters = t?.outbound?.distance?.value || 0;
      const miles = distanceMeters / 1609.34;
      travel = (miles || 0) * Number(act.costPerMile) * 2; // round trip
    } catch (e) {
      console.warn("⚠️ Travel calculation failed:", e.message);
    }
  }

  // --- 5️⃣ Total fee ---
  const total = Math.ceil(Math.max(0, base + essentialExtras + travel));

  console.log("💰 Member fee breakdown:", {
    name: `${fullMember?.firstName} ${fullMember?.lastName}`,
    base,
    essentialExtras,
    travel,
    total,
  });

  return total;
}
export { computeMemberMessageFee, getTravelData, extractOutcode, countyFromOutcode, getCountyFeeFromMap };