// Calculator used by the public act/checkout pages, ported without logging.
// Source: tsc-2025/new-frontend-deploy src/pages/utils/pricing.jsx, 11 November 2026.
// Voice supplies the confirmed county, exact lineup and a checked travel reader.
import { postcodes as outcodeToCounty } from "../utils/postcodes.js";
const calculateActPricing = async (act, selectedCounty, selectedAddress, selectedDate, selectedLineup, getTravelV2) => {
  if (!act || !selectedLineup) {
    return { total: 0, travelCalculated: false };
  }
  const normalizeCounty = (c) => String(c || "").toLowerCase().trim();
  const isManagerLike = (m = {}) => {
    const has = (s = "") => /\b(manager|management)\b/i.test(String(s));
    if (m.isManager === true || m.isNonPerformer === true) return true;
    if (has(m.instrument) || has(m.title)) return true;
    const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
    return rolesArr.some((r) => has(r?.role) || has(r?.title));
  };
  const getCountyFeeFromMap = (feesMap, countyName) => {
    if (!feesMap) return void 0;
    const target = normalizeCounty(countyName);
    const entries = typeof feesMap.forEach === "function" ? (() => {
      const arr = [];
      feesMap.forEach((v, k) => arr.push([k, v]));
      return arr;
    })() : Object.entries(feesMap);
    for (const [key, val] of entries) {
      if (normalizeCounty(key) === target) return val;
    }
    return void 0;
  };
  const getMemberCountyFee = (member, countyName, fallback) => {
    const personal = getCountyFeeFromMap(member?.countyTravelFees, countyName);
    const parsed = Number(personal);
    return personal !== void 0 && Number.isFinite(parsed) ? parsed : Number(fallback) || 0;
  };
  const hasAnyCountyFees = (feesMap) => {
    if (!feesMap) return false;
    if (typeof feesMap.size === "number") return feesMap.size > 0;
    if (typeof feesMap.forEach === "function") {
      let any = false;
      feesMap.forEach(() => {
        any = true;
      });
      return any;
    }
    return Object.keys(feesMap || {}).length > 0;
  };
  const guessCountyFromAddress = (addr, feesMap) => {
    if (!addr || !feesMap) return "";
    const addrL = String(typeof addr === "string" ? addr : addr?.address || addr?.postcode || "").toLowerCase();
    const entries = typeof feesMap.forEach === "function" ? (() => {
      const arr = [];
      feesMap.forEach((v, k) => arr.push([k, v]));
      return arr;
    })() : Object.entries(feesMap);
    for (const [key] of entries) {
      const k = normalizeCounty(key);
      if (k && addrL.includes(k)) return key;
    }
    return "";
  };
  const extractOutcode = (addr) => {
    const s = typeof addr === "string" ? addr : addr?.postcode || addr?.address || "";
    const m = String(s || "").toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b|\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/);
    return m && (m[1] || m[2]) ? m[1] || m[2] : "";
  };
  const countyFromOutcode = (outcode2) => {
    if (!outcode2) return "";
    const OUT = String(outcode2).toUpperCase().trim();
    let db = outcodeToCounty;
    if (!db && typeof window !== "undefined") {
      db = window.OUTCODE_TO_COUNTY || window.POSTCODE_TO_COUNTY || {};
    }
    if (!db) return "";
    if (typeof db.get === "function") {
      const val = db.get(OUT);
      if (val) return String(val);
      for (const [county, codes] of db.entries()) {
        if (Array.isArray(codes) && codes.includes(OUT)) return county.replace(/_/g, " ");
      }
      return "";
    }
    if (Array.isArray(db)) db = db[0] || {};
    const inverted = db[OUT];
    if (typeof inverted === "string") return inverted;
    for (const [county, codes] of Object.entries(db)) {
      if (Array.isArray(codes) && codes.includes(OUT)) return county.replace(/_/g, " ");
    }
    return "";
  };
  let travelFee = 0;
  let travelCalculated = false;
  let smallestLineup = null;
  if (selectedLineup && Array.isArray(selectedLineup.bandMembers)) {
    smallestLineup = selectedLineup;
  } else {
    smallestLineup = act.lineups?.reduce((min, lineup) => {
      if (!Array.isArray(lineup.bandMembers)) return min;
      if (!min || lineup.bandMembers.length < min.bandMembers.length) return lineup;
      return min;
    }, null);
  }
  if (!smallestLineup || !Array.isArray(smallestLineup.bandMembers)) {
    return { total: null, travelCalculated: false };
  }
  const guessedFromAddress = guessCountyFromAddress(selectedAddress, act?.countyFees);
  const outcode = extractOutcode(selectedAddress);
  const guessedFromOutcode = countyFromOutcode(outcode);
  const derivedCounty = selectedCounty || guessedFromAddress || guessedFromOutcode;
  const northernCounties = /* @__PURE__ */ new Set([
    "ceredigion",
    "cheshire",
    "cleveland",
    "conway",
    "cumbria",
    "denbighshire",
    "derbyshire",
    "durham",
    "flintshire",
    "greater manchester",
    "gwynedd",
    "herefordshire",
    "lancashire",
    "leicestershire",
    "lincolnshire",
    "merseyside",
    "north humberside",
    "north yorkshire",
    "northumberland",
    "nottinghamshire",
    "rutland",
    "shropshire",
    "south humberside",
    "south yorkshire",
    "staffordshire",
    "tyne and wear",
    "warwickshire",
    "west midlands",
    "west yorkshire",
    "worcestershire",
    "wrexham",
    "rhondda cynon taf",
    "torfaen",
    "neath port talbot",
    "bridgend",
    "blaenau gwent",
    "caerphilly",
    "cardiff",
    "merthyr tydfil",
    "newport",
    "aberdeen city",
    "aberdeenshire",
    "angus",
    "argyll and bute",
    "clackmannanshire",
    "dumfries and galloway",
    "dundee city",
    "east ayrshire",
    "east dunbartonshire",
    "east lothian",
    "east renfrewshire",
    "edinburgh",
    "falkirk",
    "fife",
    "glasgow",
    "highland",
    "inverclyde",
    "midlothian",
    "moray",
    "na h eileanan siar",
    "north ayrshire",
    "north lanarkshire",
    "orkney islands",
    "perth and kinross",
    "renfrewshire",
    "scottish borders",
    "shetland islands",
    "south ayrshire",
    "south lanarkshire",
    "stirling",
    "west dunbartonshire",
    "west lothian"
  ]);
  const isNorthernGig = northernCounties.has(normalizeCounty(derivedCounty));
  const bandMembers = act.useDifferentTeamForNorthernGigs && isNorthernGig ? act.northernTeam || [] : smallestLineup.bandMembers || [];
  const lineupSizeCount = Array.isArray(bandMembers) ? bandMembers.length : 0;
  const travelEligibleMembers = Array.isArray(bandMembers) ? bandMembers.filter((m) => !isManagerLike(m)) : [];
  const travelEligibleCount = travelEligibleMembers.length;
  const perMemberFees = (smallestLineup.bandMembers || []).map((m) => {
    const baseFee = m.isEssential ? Number(m.fee) || 0 : 0;
    const essentialRoles = (m.additionalRoles || []).filter((r) => r?.isEssential).map((r) => ({ role: r?.role, fee: Number(r?.additionalFee) || 0 }));
    const rolesTotal = essentialRoles.reduce((s, r) => s + (r.fee || 0), 0);
    const memberTotal = baseFee + rolesTotal;
    return {
      id: m?._id?.toString?.() || "",
      name: `${m.firstName || ""} ${m.lastName || ""}`.trim() || (m.instrument || "Member"),
      instrument: m.instrument,
      isEssential: !!m.isEssential,
      baseFee,
      rolesTotal,
      essentialRoles,
      memberTotal
    };
  });
  const fee = perMemberFees.reduce((s, m) => s + (m.memberTotal || 0), 0);
  const hasCountyTable = !!(act?.useCountyTravelFee && hasAnyCountyFees(act?.countyFees) && derivedCounty);
  if (hasCountyTable) {
    const feePerMemberRaw = getCountyFeeFromMap(act.countyFees, derivedCounty);
    const feePerMember = Number(feePerMemberRaw) || 0;
    if (feePerMember > 0 && travelEligibleCount > 0) {
      travelFee = travelEligibleMembers.reduce(
        (sum, member) => sum + getMemberCountyFee(member, derivedCounty, feePerMember),
        0
      );
      travelCalculated = true;
    }
  }
  if (!travelCalculated && (!selectedAddress || !selectedDate)) {
    const totalPrice2 = Math.ceil(fee / 0.75);
    return { total: totalPrice2, travelCalculated: false };
  }
  if (!travelCalculated && Number(act.costPerMile) > 0) {
    for (const m of travelEligibleMembers) {
      const postCode = m.postCode;
      const destination = typeof selectedAddress === "string" ? selectedAddress : selectedAddress?.postcode || selectedAddress?.address || "";
      if (!postCode || !destination) continue;
      const { miles } = await getTravelV2(postCode, destination, selectedDate);
      const cost = (miles || 0) * Number(act.costPerMile) * 25;
      travelFee += cost;
    }
    travelCalculated = true;
  } else if (!travelCalculated) {
    for (const m of travelEligibleMembers) {
      const postCode = m.postCode;
      const destination = typeof selectedAddress === "string" ? selectedAddress : selectedAddress?.postcode || selectedAddress?.address || "";
      if (!postCode || !destination) continue;
      const { outbound, returnTrip } = await getTravelV2(postCode, destination, selectedDate);
      if (!outbound || !returnTrip) continue;
      const totalDistanceMiles = (outbound.distance.value + returnTrip.distance.value) / 1609.34;
      const totalDurationHours = (outbound.duration.value + returnTrip.duration.value) / 3600;
      const fuelFee = totalDistanceMiles * 0.56;
      const timeFee = totalDurationHours * 13.23;
      const lateFee = returnTrip.duration.value / 3600 > 1 ? 136 : 0;
      const tollFee = (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);
      const cost = fuelFee + timeFee + lateFee + tollFee;
      travelFee += cost;
    }
    travelCalculated = true;
  }
  const totalPrice = Math.ceil((fee + travelFee) / 0.75);
  return { total: totalPrice, travelCalculated };
};
var stdin_default = calculateActPricing;
export {
  stdin_default as default
};
