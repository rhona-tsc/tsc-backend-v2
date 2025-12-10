// services/buildActFilterCard.js
// ESM module

/* -------------------------- tiny safe helpers -------------------------- */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const asArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const pick = (obj, ...keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};

/* -------------------------- image & base price ------------------------- */
function pickCardImage(act) {
  return (
    act?.coverImage?.[0]?.url ||
    act?.images?.[0]?.url ||
    act?.profileImage?.[0]?.url ||
    ""
  );
}

function computeBasePriceFromAct(act) {
  const fees = (act?.lineups || [])
    .map((l) => l?.base_fee?.total_fee ?? l?.total_fee ?? l?.base_fee)
    .filter(isNum);
  return fees.length ? Math.min(...fees) : null;
}

/* ------------------------------ genres -------------------------------- */
function extractGenres(act) {
  // your act uses "genre" (array). Fall back to "genres".
  const g = Array.isArray(act?.genre) ? act.genre : Array.isArray(act?.genres) ? act.genres : [];
  const cleaned = g.map((x) => String(x || "").trim()).filter(Boolean);
  return {
    genres: cleaned,
    genresNormalized: cleaned.map(norm),
  };
}

/* ---------------------------- lineups/meta ----------------------------- */
function lineupSizes(act) {
  // e.g. "4-Piece", "6-Piece"
  const sizes = new Set();
  for (const l of asArr(act?.lineups)) {
    const v = l?.actSize || l?.size || l?.label;
    if (v) sizes.add(String(v));
  }
  return [...sizes];
}

function smallestLineupSize(act) {
  let min = null;
  for (const l of asArr(act?.lineups)) {
    const n =
      Number(l?.bandMembers?.length) ||
      Number(l?.members?.length) ||
      Number(l?.sizeNumeric) ||
      null;
    if (isNum(n)) min = min === null ? n : Math.min(min, n);
  }
  return min;
}

/* ---------------------------- instruments ----------------------------- */
function canonicalInstruments(act) {
  // Normalise instrument names across lineups
  const set = new Set();
  for (const l of asArr(act?.lineups)) {
    for (const m of asArr(l?.bandMembers)) {
      const inst = m?.instrument || m?.role || m?.primaryInstrument;
      if (inst) set.add(norm(inst).replace(/-/g, " ")); // store human-ish labels like "lead vocal"
    }
  }
  return [...set];
}

function deriveWirelessMap(act) {
  // map instrument -> boolean wireless
  const map = {};
  for (const l of asArr(act?.lineups)) {
    for (const m of asArr(l?.bandMembers)) {
      const inst =
        m?.instrument || m?.role || m?.primaryInstrument || "unknown";
      const key = norm(inst);
      // sources of truth for "wireless" (be defensive)
      const w =
        !!m?.wireless ||
        !!m?.isWireless ||
        !!m?.gear?.wireless ||
        !!m?.vocalMicWireless;
      map[key] = Boolean(map[key] || w);
    }
  }
  return map;
}

/* ---------------------------- tech / flags ----------------------------- */
function minDbFromLineups(act) {
  // Look across plausible fields: l.db, l.dbMin, l.db?.min, l.minDb
  let min = null;
  for (const l of asArr(act?.lineups)) {
    const candidates = [
      l?.db,
      l?.dbMin,
      l?.minDb,
      l?.dbLevel,
      l?.db?.min,
      l?.soundPressure?.min,
    ].filter(isNum);
    for (const v of candidates) min = min === null ? v : Math.min(min, v);
  }
  return min;
}

function setupFlags(act) {
  // Heuristic: if act.lengthOfSets includes 60/90 OR explicit flags exist
  const lenArr = asArr(act?.lengthOfSets).map((n) => Number(n)).filter(isNum);
  const supports60 =
    lenArr.includes(60) ||
    !!act?.supports60 ||
    !!act?.actData?.supports60 ||
    !!act?.extras?.supports60;
  const supports90 =
    lenArr.includes(90) ||
    !!act?.supports90 ||
    !!act?.actData?.supports90 ||
    !!act?.extras?.supports90;

  // fast toggles (any truthy source)
  const hasElectricDrums =
    !!act?.hasElectricDrums ||
    !!act?.actData?.edrums ||
    !!act?.edrums ||
    !!act?.extras?.electric_drums ||
    !!act?.extras?.edrums;

  const hasIEMs =
    !!act?.hasIEMs ||
    !!act?.actData?.iems ||
    !!act?.extras?.iems ||
    !!act?.inEarMonitoring;

  const canMakeAcoustic =
    !!act?.canMakeAcoustic ||
    !!act?.extras?.acoustic ||
    !!act?.actData?.acoustic;

  const canRemoveDrums =
    !!act?.canRemoveDrums ||
    !!act?.extras?.remove_drums ||
    !!act?.actData?.remove_drums;

  return { supports60, supports90, hasElectricDrums, hasIEMs, canMakeAcoustic, canRemoveDrums };
}

function paLightFlags(act) {
  // Preserve raw PA/lighting objects but also compute quick booleans
  const pa =
    act?.paSystem ||
    act?.pa ||
    act?.sound ||
    {};
  const lighting =
    act?.lightingSystem ||
    act?.lighting ||
    {};

  const hasPA = Boolean(
    pa?.hasPA ??
      pa?.provided ??
      pa?.available ??
      Object.keys(pa || {}).length
  );

  const hasLighting = Boolean(
    lighting?.hasLighting ??
      lighting?.provided ??
      lighting?.available ??
      Object.keys(lighting || {}).length
  );

  return { pa, lighting, hasPA, hasLighting };
}

/* ------------------------------ extras --------------------------------- */
function extrasFlags(act) {
  // Return raw-ish extras object and a derived key list where value is truthy/price>0/complimentary
  const ex = act?.extras || {};
  const keys = new Set();

  const addKeyIf = (k, v) => {
    if (!k) return;
    const val =
      typeof v === "object" && v
        ? (isNum(v?.price) && v.price > 0) || !!v?.complimentary || !!v?.enabled
        : !!v;
    if (val) keys.add(String(k));
  };

  for (const [k, v] of Object.entries(ex)) addKeyIf(k, v);

  // also scan known structures like additional roles / flags that should be considered extras
  for (const l of asArr(act?.lineups)) {
    for (const role of asArr(l?.additionalRoles)) {
      if (role?.customRole && isNum(role?.fee)) {
        keys.add(`role:${role.customRole}`);
      }
    }
  }

  return { extras: ex, extrasKeys: [...keys] };
}

/* --------------------- ceremony & afternoon flags ---------------------- */
function ceremonyAfternoonFlags(act) {
  const ceremony = {
    solo: !!(act?.ceremony?.solo || act?.extras?.ceremony_solo),
    duo: !!(act?.ceremony?.duo || act?.extras?.ceremony_duo),
    trio: !!(act?.ceremony?.trio || act?.extras?.ceremony_trio),
    fourPiece: !!(act?.ceremony?.fourPiece || act?.extras?.ceremony_4piece),
  };

  const afternoon = {
    solo: !!(act?.afternoon?.solo || act?.extras?.afternoon_solo),
    duo: !!(act?.afternoon?.duo || act?.extras?.afternoon_duo),
    trio: !!(act?.afternoon?.trio || act?.extras?.afternoon_trio),
    fourPiece: !!(act?.afternoon?.fourPiece || act?.extras?.afternoon_4piece),
  };

  const hasCeremonyOptions = Object.values(ceremony).some(Boolean);
  const hasAfternoonOptions = Object.values(afternoon).some(Boolean);

  return { ceremony, afternoon, hasCeremonyOptions, hasAfternoonOptions };
}

/* ------------------------------ travel --------------------------------- */
function travelSummary(act) {
  const perMile = Number(act?.costPerMile) > 0;
  const county = !!act?.useCountyTravelFee;
  return {
    type: county ? "county" : perMile ? "per-mile" : "mu",
    useCountyTravelFee: !!act?.useCountyTravelFee,
    costPerMile: Number(act?.costPerMile) || 0,
    hasCountyFees: !!act?.countyFees && Object.keys(act.countyFees).length > 0,
  };
}

/* ----------------------------- main build ------------------------------ */
export function buildCard(act) {
  const { genres, genresNormalized } = extractGenres(act);
  const lineup_sizes = lineupSizes(act);
  const wirelessByInstrument = deriveWirelessMap(act);
  const wirelessInstruments = Object.entries(wirelessByInstrument)
    .filter(([, v]) => !!v)
    .map(([k]) => k.replace(/-/g, " "));

  const {
    supports60,
    supports90,
    hasElectricDrums,
    hasIEMs,
    canMakeAcoustic,
    canRemoveDrums,
  } = setupFlags(act);

  const { pa, lighting, hasPA, hasLighting } = paLightFlags(act);
  const { extras, extrasKeys } = extrasFlags(act);
  const { ceremony, afternoon, hasCeremonyOptions, hasAfternoonOptions } = ceremonyAfternoonFlags(act);

  return {
    // identity / status / hero
    actId: act?._id,
    tscName: act?.tscName || act?.name || "",
    name: act?.name || "",
    status: act?.status || "draft",
    isTest: !!(act?.isTest || act?.actData?.isTest),
    imageUrl: pickCardImage(act),

    // pricing
    basePrice: computeBasePriceFromAct(act),
    loveCount: Number(act?.loveCount || 0),
    amendmentPending: Boolean(act?.amendment?.isPending ?? act?.amendmentPending),

    // genres
    genres,
    genresNormalized,

    // lineups & instruments
    lineupSizes: lineup_sizes,
    smallestLineupSize: smallestLineupSize(act),
    instruments: canonicalInstruments(act),
    wirelessByInstrument,
    wirelessInstruments,

    // tech / setup
    hasElectricDrums,
    hasIEMs,
    canMakeAcoustic,
    canRemoveDrums,
    minDb: minDbFromLineups(act),
    supports60,
    supports90,

    // PA / Lighting
    pa,
    lighting,
    hasPA,
    hasLighting,

    // extras
    extras,
    extrasKeys,

    // ceremony / afternoon
    ceremony,
    afternoon,
    hasCeremonyOptions,
    hasAfternoonOptions,

    // compliance
    pliAmount: Number(act?.pliAmount) || 0,

    // travel
    travelModel: travelSummary(act),
  };
}