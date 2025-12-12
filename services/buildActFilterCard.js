// services/buildActFilterCard.js
// ESM module
import { v4 as uuidv4 } from "uuid";

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
  const fees = (act?.lineups || []).flatMap((l) => {
    const bf = l?.base_fee;
    if (Array.isArray(bf) && bf.length) {
      return bf
        .map((x) => Number(x?.total_fee ?? x))
        .filter((n) => Number.isFinite(n));
    }
    const f1 = Number(l?.total_fee);
    const f2 = Number(l?.base_fee);
    return [f1, f2].filter((n) => Number.isFinite(n));
  });
  return fees.length ? Math.min(...fees) : null;
}

/* ------------------------------ genres -------------------------------- */
function extractGenres(act) {
  const g = Array.isArray(act?.genre)
    ? act.genre
    : Array.isArray(act?.genres)
    ? act.genres
    : [];
  const cleaned = g.map((x) => String(x || "").trim()).filter(Boolean);
  return {
    genres: cleaned,
    genresNormalized: cleaned.map(norm),
  };
}

/* ---------------------------- lineups/meta ----------------------------- */
function lineupSizes(act) {
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
  const set = new Set();
  for (const l of asArr(act?.lineups)) {
    for (const m of asArr(l?.bandMembers)) {
      const inst = m?.instrument || m?.role || m?.primaryInstrument;
      if (inst) set.add(norm(inst).replace(/-/g, " "));
    }
  }
  return [...set];
}

function deriveWirelessMap(act) {
  const map = {};
  for (const l of asArr(act?.lineups)) {
    for (const m of asArr(l?.bandMembers)) {
      const inst =
        m?.instrument || m?.role || m?.primaryInstrument || "unknown";
      const key = norm(inst);
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
  const pa =
    act?.paSystem ||
    act?.pa ||
    act?.sound ||
    {};
  const lighting =
    act?.lightingSystem ||
    act?.lighting ||
    {};

  const hasPA =
    !!pa?.hasPA || !!pa?.provided || !!pa?.available || Object.keys(pa || {}).length > 0;

  const hasLighting =
    !!lighting?.hasLighting ||
    !!lighting?.provided ||
    !!lighting?.available ||
    Object.keys(lighting || {}).length > 0;

  return { pa, lighting, hasPA, hasLighting };
}

/* ------------------------------ extras --------------------------------- */
function extrasFlags(act) {
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

/* -------------------------- lineups (lite) ----------------------------- */
function buildLineupsLite(act) {
  const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
  return lineups.map((l) => ({
    lineupId: l?.lineupId || l?._id?.toString?.() || uuidv4(),
    actSize: l?.actSize || l?.size || l?.label || "",
    bandMembers: (l?.bandMembers || []).map((m) => ({
      fee: Number(m?.fee) || 0,
      additionalRoles: (m?.additionalRoles || []).map((r) => ({
        additionalFee: Number(r?.additionalFee ?? r?.fee) || 0,
        isEssential: !!r?.isEssential,
      })),
    })),
    base_fee: (l?.base_fee || []).map((b) => ({
      act_size: b?.act_size || l?.actSize || "",
      total_fee: Number(b?.total_fee ?? b) || 0,
      fee_allocations: b?.fee_allocations || {},
    })),
  }));
}

/* ---------------------- repertoire tokenisation ----------------------- */
function splitWords(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .split(/[^a-z0-9']+/)        // keep numbers & apostrophes
    .filter(Boolean);
}

function buildRepertoireTokens(act) {
  const songs = Array.isArray(act?.selectedSongs)
    ? act.selectedSongs
    : Array.isArray(act?.repertoire)
    ? act.repertoire
    : [];

  const wordTokens = new Set();       // words from title + artist
  const artistWordTokens = new Set(); // words from artist only
  const songPhrases = new Set();      // full titles (lowercased)
  const artistPhrases = new Set();    // full artist names (lowercased)

  for (const s of songs) {
    const title = String(s?.title || "").trim();
    const artist = String(s?.artist || "").trim();

    if (title) {
      const t = title.toLowerCase();
      songPhrases.add(t);
      splitWords(title).forEach((w) => wordTokens.add(w));
    }
    if (artist) {
      const a = artist.toLowerCase();
      artistPhrases.add(a);
      splitWords(artist).forEach((w) => {
        wordTokens.add(w);
        artistWordTokens.add(w);
      });
    }
  }

  return {
    repertoireTokens: [...wordTokens],
    artistTokens: [...artistWordTokens],
    songPhrases: [...songPhrases],
    artistPhrases: [...artistPhrases],
  };
}

/* ----------------------------- main build ------------------------------ */
// services/buildActFilterCard.js
// ESM module


const pick = (obj, ...keys) => {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
};

/* --------------------- snake_case extras normalizer -------------------- */
const toSnake = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const looksTruthy = (v) =>
  v === true ||
  v === "true" ||
  v === 1 ||
  v === "1" ||
  (v && typeof v === "object" && (
    Number(v.price) > 0 || v.complimentary === true || v.enabled === true
  ));

/** Normalize extras from the act into { [snake_key]: true } */
function normalizeExtrasFromAct(act) {
  const src = act?.extras || {};
  const out = {};
  const keyMap = {};

  // direct extras on the act
  for (const [k, v] of Object.entries(src)) {
    const nk = toSnake(k);
    keyMap[k] = nk;
    if (looksTruthy(v)) out[nk] = true;
  }

  // also treat additional roles-with-fees as extras (optional)
  for (const l of asArr(act?.lineups)) {
    for (const r of asArr(l?.additionalRoles)) {
      if (r?.customRole && Number(r?.fee) > 0) {
        const nk = toSnake(`role_${r.customRole}`);
        keyMap[`role:${r.customRole}`] = nk;
        out[nk] = true;
      }
    }
  }

  return { extrasSnake: out, extrasKeysSnake: Object.keys(out), extrasKeyMap: keyMap };
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
  const { extrasSnake, extrasKeysSnake } = normalizeExtrasFromAct(act);
  const { songPhrases, artistPhrases, repertoireTokens, artistTokens } = buildRepertoireTokens(act);

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

    // extras (normalized to snake_case booleans)
    extras: extrasSnake,          // { background_music_playlist: true, ... }
    extrasKeys: extrasKeysSnake,  // ["background_music_playlist", ... ]

    // ceremony / afternoon (derived from act.extras too)
    ceremony: {
      solo: !!(act?.ceremony?.solo || act?.extras?.ceremony_solo),
      duo: !!(act?.ceremony?.duo || act?.extras?.ceremony_duo),
      trio: !!(act?.ceremony?.trio || act?.extras?.ceremony_trio),
      fourpiece: !!(act?.ceremony?.fourPiece || act?.extras?.ceremony_4piece),
    },
    afternoon: {
      solo: !!(act?.afternoon?.solo || act?.extras?.afternoon_solo),
      duo: !!(act?.afternoon?.duo || act?.extras?.afternoon_duo),
      trio: !!(act?.afternoon?.trio || act?.extras?.afternoon_trio),
      fourpiece: !!(act?.afternoon?.fourPiece || act?.extras?.afternoon_4piece),
    },

    // compliance
    pliAmount: Number(act?.pliAmount) || 0,

    // travel
    travelModel: travelSummary(act),

    // lightweight lineups payload for cards
    lineups: buildLineupsLite(act),

    // repertoire search helpers
    repertoireTokens, // word tokens from title + artist
    artistTokens,     // word tokens from artist only
    songPhrases,      // full song titles (lowercased)
    artistPhrases,    // full artist names (lowercased)
  };
}