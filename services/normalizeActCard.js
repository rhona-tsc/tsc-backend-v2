// services/normalizeActCard.js
// ESM module

export function normalizeActCard(raw = {}, act = {}) {
  // Safe arrays/maps
  const arr = (v) => (Array.isArray(v) ? v : []);
  const mapObj =
    raw?.wirelessByInstrument && typeof raw.wirelessByInstrument === "object"
      ? raw.wirelessByInstrument
      : {};

  return {
    // identity / status / hero
    actId: raw.actId || act._id,
    tscName: safeStr(raw.tscName || act.tscName || act.name),
    name: safeStr(raw.name || act.name),
    status: safeStr(raw.status || act.status || "draft"),
    isTest: !!(raw.isTest || act.isTest || act.actData?.isTest),
    imageUrl: safeStr(raw.imageUrl),

    // pricing / engagement
    basePrice: numOrNull(raw.basePrice),
    loveCount: toNumber(raw.loveCount, 0),
    amendmentPending: !!(raw.amendmentPending),

    // genres
    genres: arr(raw.genres),
    genresNormalized: arr(raw.genresNormalized),

    // lineups & instruments
    lineupSizes: arr(raw.lineupSizes),
    smallestLineupSize: numOrNull(raw.smallestLineupSize),
    instruments: arr(raw.instruments),
    wirelessByInstrument: mapObj,
    wirelessInstruments: arr(raw.wirelessInstruments),

    // tech / setup
    hasElectricDrums: !!raw.hasElectricDrums,
    hasIEMs: !!raw.hasIEMs,
    canMakeAcoustic: !!raw.canMakeAcoustic,
    canRemoveDrums: !!raw.canRemoveDrums,
    minDb: numOrNull(raw.minDb),
    supports60: !!raw.supports60,
    supports90: !!raw.supports90,

    // PA / Lighting
    pa: raw.pa || {},
    lighting: raw.lighting || {},
    hasPA: !!raw.hasPA,
    hasLighting: !!raw.hasLighting,

    // extras
    extras: raw.extras || {},
    extrasKeys: arr(raw.extrasKeys),

    // ceremony / afternoon
    ceremony: raw.ceremony || {},
    afternoon: raw.afternoon || {},
    hasCeremonyOptions: !!raw.hasCeremonyOptions,
    hasAfternoonOptions: !!raw.hasAfternoonOptions,

    // compliance
    pliAmount: toNumber(raw.pliAmount, 0),

    // travel
    travelModel: normalizeTravel(raw.travelModel, act),
  };
}

function safeStr(v) { return (v == null) ? "" : String(v); }
function toNumber(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function normalizeTravel(t = {}, act = {}) {
  const perMile = Number(act?.costPerMile) > 0;
  const county = !!act?.useCountyTravelFee;
  const fallbackType = county ? "county" : perMile ? "per-mile" : "mu";
  return {
    type: t?.type || fallbackType,
    useCountyTravelFee: !!(t?.useCountyTravelFee ?? act?.useCountyTravelFee),
    costPerMile: Number(t?.costPerMile ?? act?.costPerMile) || 0,
    hasCountyFees: !!(t?.hasCountyFees ?? (act?.countyFees && Object.keys(act.countyFees).length > 0)),
  };
}