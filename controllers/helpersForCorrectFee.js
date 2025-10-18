// backend/controllers/helpersForCorrectFee.js
import fetch from "node-fetch";
import { postcodes } from "../utils/postcodes.js";

const normalizeCounty = (c) => String(c || "").toLowerCase().trim();

let OUT_TO_COUNTY;
const titleCase = (s = "") =>
  String(s)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/_/g, " ");

/* -------------------------------------------------------------------------- */
/*                            ensureOutToCounty                               */
/* -------------------------------------------------------------------------- */
function ensureOutToCounty() {
  console.log(`💰 (controllers/helpersForCorrectFee.js) ensureOutToCounty called at`, new Date().toISOString());
  if (OUT_TO_COUNTY) {
    console.log(`💰 ensureOutToCounty cache already built`);
    return;
  }

  OUT_TO_COUNTY = new Map();
  const root = Array.isArray(postcodes) ? postcodes[0] || {} : postcodes || {};

  for (const [countyKey, outs] of Object.entries(root)) {
    const countyName = titleCase(countyKey);
    if (!Array.isArray(outs)) continue;
    for (const oc of outs) {
      OUT_TO_COUNTY.set(String(oc).toUpperCase().trim(), countyName);
    }
  }
  console.log(`💰 ensureOutToCounty built map`, { size: OUT_TO_COUNTY.size });
}

/* -------------------------------------------------------------------------- */
/*                               extractOutcode                               */
/* -------------------------------------------------------------------------- */
const extractOutcode = (addr) => {
  console.log(`💰 (controllers/helpersForCorrectFee.js) extractOutcode called at`, new Date().toISOString(), { addr });
  const s = typeof addr === "string" ? addr : addr?.postcode || addr?.address || "";
  const m = String(s || "")
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b|\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/);
  const result = m && (m[1] || m[2]) ? (m[1] || m[2]) : "";
  console.log(`💰 extractOutcode result`, { result });
  return result;
};

/* -------------------------------------------------------------------------- */
/*                             countyFromOutcode                              */
/* -------------------------------------------------------------------------- */
const countyFromOutcode = (outcode) => {
  console.log(`💰 (controllers/helpersForCorrectFee.js) countyFromOutcode called at`, new Date().toISOString(), { outcode });
  if (!outcode) return "";
  ensureOutToCounty();
  const OUT = String(outcode).toUpperCase().trim();
  const county = OUT_TO_COUNTY.get(OUT) || "";
  console.log(`💰 countyFromOutcode resolved`, { OUT, county });
  return county;
};

/* -------------------------------------------------------------------------- */
/*                             getCountyFeeFromMap                            */
/* -------------------------------------------------------------------------- */
const getCountyFeeFromMap = (feesMap, countyName) => {
  console.log(`💰 (controllers/helpersForCorrectFee.js) getCountyFeeFromMap called at`, new Date().toISOString(), {
    hasMap: !!feesMap,
    countyName,
  });
  if (!feesMap || !countyName) return 0;

  const target = normalizeCounty(countyName);
  const iter =
    typeof feesMap.forEach === "function"
      ? (() => {
          const arr = [];
          feesMap.forEach((v, k) => arr.push([k, v]));
          return arr;
        })()
      : Object.entries(feesMap);

  for (const [k, v] of iter) {
    if (normalizeCounty(k) === target) {
      console.log(`💰 getCountyFeeFromMap match found`, { k, v });
      return Number(v) || 0;
    }
  }

  console.log(`💰 getCountyFeeFromMap no match found`, { countyName });
  return 0;
};

/* -------------------------------------------------------------------------- */
/*                                 getTravelData                              */
/* -------------------------------------------------------------------------- */
async function getTravelData(originPostcode, destination, dateISO) {
  console.log(`💰 (controllers/helpersForCorrectFee.js) getTravelData called at`, new Date().toISOString(), {
    originPostcode,
    destination,
    dateISO,
  });

  const qs = new URLSearchParams({ origin: originPostcode, destination, date: dateISO }).toString();
  const BASE = (
    process.env.INTERNAL_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    "https://tsc-backend-v2.onrender.com"
  ).replace(/\/+$/, "");
  const url = `${BASE}/api/v2/travel?${qs}`;
  console.log(`💰 getTravelData fetching`, { url });

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    console.warn(`💰 getTravelData JSON parse error`, err?.message || err);
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
    console.error(`💰 getTravelData failed`, { status: res.status, msg });
    throw new Error(`travel ${res.status} - ${msg}`);
  }

  const firstEl = data?.rows?.[0]?.elements?.[0];
  const outbound =
    data?.outbound ||
    (firstEl?.distance && firstEl?.duration
      ? { distance: firstEl.distance, duration: firstEl.duration, fare: firstEl.fare }
      : undefined);

  const result = { outbound, returnTrip: data?.returnTrip, raw: data };
  console.log(`💰 getTravelData success`, {
    outbound: outbound ? outbound.distance?.text : null,
    returnTrip: !!data?.returnTrip,
  });
  return result;
}

/* -------------------------------------------------------------------------- */
/*                           computeMemberMessageFee                          */
/* -------------------------------------------------------------------------- */
async function computeMemberMessageFee({ act, lineup, member, address, dateISO }) {
  console.log(`💰 (controllers/helpersForCorrectFee.js) computeMemberMessageFee called at`, new Date().toISOString(), {
    actId: act?._id,
    lineupId: lineup?._id,
    member: member?.firstName || member?.name,
    address,
    dateISO,
  });

  if (!member || !lineup) {
    console.warn(`💰 computeMemberMessageFee missing member or lineup`);
    return 0;
  }

  const fullMember = lineup.bandMembers?.find(
    (m) =>
      m._id?.toString() === member._id?.toString() ||
      m.email?.toLowerCase() === member.email?.toLowerCase() ||
      m.phoneNumber?.replace(/\s+/g, "") === member.phoneNumber?.replace(/\s+/g, "")
  );

  if (!fullMember) {
    console.warn(`💰 computeMemberMessageFee no matching lineup member`, { name: member?.firstName });
  }

  const base = Number(fullMember?.fee ?? member?.fee ?? 0);
  const essentialExtras = (fullMember?.additionalRoles || [])
    .filter((r) => r.isEssential)
    .reduce((sum, r) => sum + Number(r.additionalFee || 0), 0);

  let travel = 0;

  // County-based
  if (act?.useCountyTravelFee) {
    const outcode = extractOutcode(address);
    const county = countyFromOutcode(outcode);
    const perMember = getCountyFeeFromMap(act?.countyFees, county);
    if (perMember > 0) {
      travel = perMember;
      console.log(`💰 computeMemberMessageFee county travel`, { county, travel });
    }
  }

  // Cost-per-mile fallback
  if (!travel && Number(act?.costPerMile) > 0 && fullMember?.postCode && address) {
    try {
      const dest =
        typeof address === "string"
          ? address
          : address?.postcode || address?.address || "";
      const t = await getTravelData(fullMember.postCode, dest, dateISO);
      const distanceMeters = t?.outbound?.distance?.value || 0;
      const miles = distanceMeters / 1609.34;
      travel = (miles || 0) * Number(act.costPerMile) * 2;
      console.log(`💰 computeMemberMessageFee distance-based travel`, { miles, travel });
    } catch (e) {
      console.warn(`💰 computeMemberMessageFee travel calc failed`, e.message);
    }
  }

  const total = Math.ceil(Math.max(0, base + essentialExtras + travel));

  console.log(`💰 computeMemberMessageFee breakdown`, {
    name: `${fullMember?.firstName || ""} ${fullMember?.lastName || ""}`.trim(),
    base,
    essentialExtras,
    travel,
    total,
  });

  return total;
}

/* -------------------------------------------------------------------------- */
/*                                   EXPORTS                                  */
/* -------------------------------------------------------------------------- */
export { computeMemberMessageFee, getTravelData, extractOutcode, countyFromOutcode, getCountyFeeFromMap };