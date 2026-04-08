// services/deputyJobMatcher.js
import musicianModel from "../models/musicianModel.js";
import { postcodes as POSTCODE_MAP_ARR } from "../utils/postcodes.js";

const POSTCODE_MAP =
  (Array.isArray(POSTCODE_MAP_ARR) && POSTCODE_MAP_ARR[0]) || {};

const COUNTY_NEIGHBORS = {
  bedfordshire: ["buckinghamshire", "hertfordshire", "cambridgeshire", "northamptonshire"],
  berkshire: ["oxfordshire", "hampshire", "surrey", "greater london", "buckinghamshire", "wiltshire"],
  bristol: ["gloucestershire", "somerset", "wilts", "wiltshire"],
  buckinghamshire: ["oxfordshire", "northamptonshire", "bedfordshire", "hertfordshire", "greater london", "berkshire"],
  cambridgeshire: ["lincolnshire", "norfolk", "suffolk", "essex", "hertfordshire", "bedfordshire", "northamptonshire", "peterborough"],
  cheshire: ["merseyside", "greater manchester", "derbyshire", "staffordshire", "shropshire", "flintshire"],
  "city of london": ["greater london"],
  cornwall: ["devon", "isles of scilly"],
  cumbria: ["northumberland", "durham", "north yorkshire", "lancashire", "dumfries and galloway", "scottish borders"],
  derbyshire: ["greater manchester", "west yorkshire", "south yorkshire", "nottinghamshire", "leicestershire", "staffordshire", "cheshire"],
  devon: ["cornwall", "somerset", "dorset"],
  dorset: ["devon", "somerset", "wiltshire", "hampshire"],
  durham: ["northumberland", "tyne and wear", "north yorkshire", "cumbria"],
  "east riding of yorkshire": ["north yorkshire", "south yorkshire", "lincolnshire", "north lincolnshire"],
  "east sussex": ["kent", "surrey", "west sussex"],
  essex: ["greater london", "hertfordshire", "cambridgeshire", "suffolk", "kent", "thurrock"],
  gloucestershire: ["worcestershire", "warwickshire", "oxfordshire", "wiltshire", "bristol", "south gloucestershire", "somerset", "herefordshire"],
  "greater london": ["kent", "surrey", "berkshire", "buckinghamshire", "hertfordshire", "essex", "city of london"],
  "greater manchester": ["merseyside", "lancashire", "west yorkshire", "derbyshire", "cheshire"],
  hampshire: ["dorset", "wiltshire", "berkshire", "surrey", "west sussex", "isle of wight"],
  herefordshire: ["gloucestershire", "worcestershire", "shropshire", "powys", "monmouthshire"],
  hertfordshire: ["bedfordshire", "buckinghamshire", "greater london", "essex", "cambridgeshire"],
  "isle of wight": ["hampshire"],
  kent: ["greater london", "surrey", "east sussex", "essex", "medway"],
  lancashire: ["cumbria", "north yorkshire", "west yorkshire", "greater manchester", "merseyside"],
  leicestershire: ["nottinghamshire", "derbyshire", "staffordshire", "warwickshire", "northamptonshire", "rutland", "lincolnshire"],
  lincolnshire: ["nottinghamshire", "south yorkshire", "east riding of yorkshire", "north lincolnshire", "cambridgeshire", "rutland", "leicestershire", "northamptonshire", "norfolk"],
  merseyside: ["lancashire", "greater manchester", "cheshire", "flintshire"],
  norfolk: ["lincolnshire", "cambridgeshire", "suffolk"],
  "north yorkshire": ["cumbria", "durham", "west yorkshire", "south yorkshire", "east riding of yorkshire", "lancashire"],
  northamptonshire: ["leicestershire", "rutland", "cambridgeshire", "bedfordshire", "buckinghamshire", "oxfordshire", "warwickshire", "lincolnshire"],
  northumberland: ["cumbria", "durham", "tyne and wear", "scottish borders"],
  nottinghamshire: ["lincolnshire", "south yorkshire", "derbyshire", "leicestershire"],
  oxfordshire: ["warwickshire", "northamptonshire", "buckinghamshire", "berkshire", "wiltshire", "gloucestershire"],
  rutland: ["lincolnshire", "leicestershire", "northamptonshire"],
  shropshire: ["cheshire", "staffordshire", "worcestershire", "herefordshire", "powys", "wrexham"],
  somerset: ["devon", "dorset", "wiltshire", "gloucestershire", "bristol"],
  "south yorkshire": ["west yorkshire", "north yorkshire", "east riding of yorkshire", "lincolnshire", "nottinghamshire", "derbyshire"],
  staffordshire: ["cheshire", "derbyshire", "leicestershire", "warwickshire", "west midlands", "worcestershire", "shropshire"],
  suffolk: ["norfolk", "cambridgeshire", "essex"],
  surrey: ["greater london", "kent", "east sussex", "west sussex", "hampshire", "berkshire"],
  "tyne and wear": ["northumberland", "durham"],
  warwickshire: ["west midlands", "worcestershire", "gloucestershire", "oxfordshire", "northamptonshire", "leicestershire", "staffordshire"],
  "west midlands": ["staffordshire", "warwickshire", "worcestershire", "shropshire"],
  "west sussex": ["surrey", "east sussex", "hampshire"],
  "west yorkshire": ["lancashire", "north yorkshire", "south yorkshire", "greater manchester"],
  wiltshire: ["gloucestershire", "oxfordshire", "berkshire", "hampshire", "dorset", "somerset"],
  worcestershire: ["shropshire", "staffordshire", "west midlands", "warwickshire", "gloucestershire", "herefordshire"],
  "isles of scilly": ["cornwall"],
  peterborough: ["cambridgeshire", "lincolnshire", "northamptonshire", "rutland"],
  "south gloucestershire": ["bristol", "gloucestershire"],
  "north lincolnshire": ["lincolnshire", "east riding of yorkshire", "south yorkshire", "nottinghamshire"],
  thurrock: ["essex"],
  medway: ["kent"],
  wilts: ["gloucestershire", "oxfordshire", "berkshire", "hampshire", "dorset", "somerset", "bristol"],
};

const norm = (s = "") => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const ROLE_ALIASES = {
  "band leader": ["musical director", "md"],
  "musical director": ["band leader", "md"],
  "dj with decks": ["dj", "dj with mixing console", "dj with console", "dj with controller"],
  "dj with mixing console": ["dj", "dj with decks", "dj with controller"],
  "client liaison": ["client liason", "client-facing", "client facing"],
  "backing vocalist": ["backing vocals", "bv", "bv singer", "backing singer"],
  "lead vocalist": ["lead vocals", "lead singer"],
  rap: ["rapper", "mc", "emcee", "can rap", "mc/rapper"],
  "sound engineering": [
    "sound engineer",
    "audio engineer",
    "foh",
    "front of house",
    "sound engineering with pa & lights provision",
  ],
};

const aliasSet = new Map(
  Object.entries(ROLE_ALIASES).map(([k, arr]) => [norm(k), new Set(arr.map(norm))])
);

const countyKey = (name = "") => String(name).toLowerCase().replace(/\s+/g, "_");

const outwardCode = (postcode = "") =>
  String(postcode || "").toUpperCase().replace(/\s+/g, "").slice(0, 3);

const countyFromPostcode = (postcode = "") => {
  const outward = outwardCode(postcode);
  if (!outward) return "";

  for (const [county, districts] of Object.entries(POSTCODE_MAP)) {
    if (
      Array.isArray(districts) &&
      districts.some((district) => outward.startsWith(String(district).toUpperCase().trim()))
    ) {
      return county.replace(/_/g, " ");
    }
  }

  return "";
};

const neighboursForCounty = (countyName = "") => {
  const key = countyKey(countyName);
  const direct = COUNTY_NEIGHBORS[norm(countyName)] || [];
  if (direct.length) return direct;

  const mine = new Set(
    (POSTCODE_MAP[key] || []).map((value) => String(value).toUpperCase().trim())
  );

  if (!mine.size) return [];

  const out = new Set();
  for (const [candidateCountyKey, prefixes] of Object.entries(POSTCODE_MAP)) {
    if (candidateCountyKey === key) continue;
    const overlaps = (prefixes || []).some((prefix) =>
      mine.has(String(prefix).toUpperCase().trim())
    );
    if (overlaps) out.add(candidateCountyKey.replace(/_/g, " "));
  }

  return Array.from(out);
};

const scoreLocation = ({
  targetCounty,
  targetPostcode,
  musicianCounty,
  musicianPostcode,
  neighbourCounties = [],
}) => {
  const tc = norm(targetCounty);
  const mc = norm(musicianCounty);

  if (tc && mc && tc === mc) return 1;
  if (neighbourCounties.some((county) => norm(county) === mc)) return 0.8;

  const tp = String(targetPostcode || "").toUpperCase().replace(/\s+/g, "");
  const mp = String(musicianPostcode || "").toUpperCase().replace(/\s+/g, "");

  if (tp && mp && tp.slice(0, 2) === mp.slice(0, 2)) return 0.6;

  return 0;
};

const roleSimilarity = (a, b) => {
  const A = norm(a);
  const B = norm(b);

  if (!A || !B) return 0;
  if (A === B) return 1;
  if (aliasSet.get(A)?.has(B) || aliasSet.get(B)?.has(A)) return 1;

  const tokensA = new Set(A.split(/[^a-z0-9]+/).filter(Boolean));
  const tokensB = new Set(B.split(/[^a-z0-9]+/).filter(Boolean));

  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }

  const jaccard = intersection / (tokensA.size + tokensB.size - intersection);
  return jaccard >= 0.5 ? 0.6 : 0;
};

const hasInstrument = (musician, wanted) => {
  const instruments = Array.isArray(musician?.instrumentation)
    ? musician.instrumentation.map((item) => norm(item?.instrument || item))
    : [];

  const target = norm(wanted);
  if (!target) return true;

  return instruments.some(
    (instrument) =>
      instrument === target ||
      instrument.includes(target) ||
      target.includes(instrument)
  );
};

const getVocalTypes = (musician) =>
  Array.isArray(musician?.vocals?.type)
    ? musician.vocals.type.map(norm).filter(Boolean)
    : [];

const getVocalGender = (musician) => norm(musician?.vocals?.gender || "");

const isFemaleVocalist = (musician) => {
  const vocalTypes = getVocalTypes(musician);
  const gender = getVocalGender(musician);

  const hasVocalType = vocalTypes.some(
    (type) =>
      type.includes("lead vocalist") ||
      type.includes("backing vocalist") ||
      type.includes("vocalist-instrumentalist")
  );

  return hasVocalType && gender === "female";
};

const isLeadFemaleVocalist = (musician) => {
  const vocalTypes = getVocalTypes(musician);
  const gender = getVocalGender(musician);

  const hasLeadType = vocalTypes.some((type) =>
    type.includes("lead vocalist")
  );

  return hasLeadType && gender === "female";
};

const wantsFemaleLeadVocalist = (instrument = "") => {
  const target = norm(instrument);
  return (
    target.includes("female") &&
    (target.includes("lead vocalist") ||
      target.includes("lead vocal") ||
      target.includes("vocalist") ||
      target.includes("singer"))
  );
};

const isVocalist = (musician) => {
  const vocalTypes = getVocalTypes(musician);

  if (
    vocalTypes.some(
      (type) =>
        type.includes("lead vocalist") ||
        type.includes("backing vocalist") ||
        type.includes("vocalist-instrumentalist")
    )
  ) {
    return true;
  }

  const instruments = Array.isArray(musician?.instrumentation)
    ? musician.instrumentation.map((item) => norm(item?.instrument || item))
    : [];

  if (instruments.some((instrument) => /vocal|singer|rap|mc/.test(instrument))) {
    return true;
  }

  const rapValue = String(musician?.vocals?.rap ?? "").toLowerCase();
  if (rapValue === "true" || rapValue === "yes") return true;

  const skills = Array.isArray(musician?.other_skills)
    ? musician.other_skills.map(norm)
    : [];

  return skills.some((skill) => /backing\s*voc|bv/.test(skill));
};

const hasAllEssentialRoles = (musician, essentialRoles = []) => {
  if (!essentialRoles.length) return true;

  const skills = Array.isArray(musician?.other_skills)
    ? musician.other_skills.map(norm)
    : [];

  const vocalTypes = getVocalTypes(musician);

  return essentialRoles.every((requiredRole) => {
    const wanted = norm(requiredRole);
    if (!wanted) return true;

    if (/backing\s*voc|backing vocalist|bv/.test(wanted)) {
      if (vocalTypes.some((type) => type.includes("backing vocalist"))) {
        return true;
      }

      if (vocalTypes.some((type) => type.includes("lead vocalist"))) {
        return true;
      }
    }

    return skills.some(
      (existingRole) => roleSimilarity(existingRole, requiredRole) >= 0.6
    );
  });
};

const desiredRoleScore = (musician, desiredRoles = []) => {
  if (!desiredRoles.length) return 0;

  const skills = Array.isArray(musician?.other_skills)
    ? musician.other_skills.map(norm)
    : [];

  let total = 0;
  let count = 0;

  for (const desiredRole of desiredRoles) {
    const wanted = norm(desiredRole);
    if (!wanted) continue;

    let best = 0;
    for (const existingRole of skills) {
      const similarity = roleSimilarity(existingRole, wanted);
      if (similarity > best) best = similarity;
      if (best === 1) break;
    }

    if (/backing/.test(wanted)) {
      const vocalTypes = Array.isArray(musician?.vocals?.type)
        ? musician.vocals.type.map(norm)
        : [];

      if (vocalTypes.some((type) => /backing/.test(type))) best = Math.max(best, 1);
      else if (vocalTypes.some((type) => /lead/.test(type))) best = Math.max(best, 0.8);
    }

    if (/rap/.test(wanted)) {
      const rapValue = String(musician?.vocals?.rap ?? "").toLowerCase();
      if (rapValue === "true" || rapValue === "yes") best = Math.max(best, 1);
    }

    total += best;
    count += 1;
  }

  return count ? total / count : 0;
};

const genreScore = (musician, wantedGenres = []) => {
  if (!wantedGenres.length) return 0;

  const singerGenres = Array.isArray(musician?.vocals?.genres)
    ? musician.vocals.genres.map(norm)
    : [];

  const topLevelGenres = Array.isArray(musician?.genres)
    ? musician.genres.map(norm)
    : [];

  const musicianGenres = topLevelGenres.length ? topLevelGenres : singerGenres;
  const wanted = wantedGenres.map(norm).filter(Boolean);

  if (!wanted.length) return 0;

  const overlap = wanted.filter((genre) => musicianGenres.includes(genre)).length;
  return overlap / wanted.length;
};

export const findMatchingMusiciansForDeputyJob = async ({
  instrument,
  isVocalSlot = false,
  essentialRoles = [],
  desiredRoles = [],
  secondaryInstruments = [],
  genres = [],
  county = "",
  postcode = "",
  excludeIds = [],
  limit = 100,
}) => {
  const pool = await musicianModel
    .find({
      role: "musician",
      status: { $in: ["approved", "Approved, changes pending"] },
      ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
    })
    .lean();

  const resolvedCounty = county || countyFromPostcode(postcode);
  const neighbourCounties = neighboursForCounty(resolvedCounty);
  const femaleLeadOnly = wantsFemaleLeadVocalist(instrument);

  const filtered = pool
    .filter((musician) => {
      if (!hasAllEssentialRoles(musician, essentialRoles)) return false;

      if (isVocalSlot) {
        if (femaleLeadOnly) {
          if (!isLeadFemaleVocalist(musician)) return false;
        } else if (!isVocalist(musician)) {
          return false;
        }
      } else if (!hasInstrument(musician, instrument)) {
        return false;
      }

      if (!hasAnySecondary(musician, secondaryInstruments)) return false;

      return true;
    })
    .map((musician) => {
      const roleFit = desiredRoleScore(musician, desiredRoles);
      const genreFit = genreScore(musician, genres);
      const locationFit = scoreLocation({
        targetCounty: resolvedCounty,
        targetPostcode: postcode,
        musicianCounty: musician?.address?.county || countyFromPostcode(musician?.address?.postcode),
        musicianPostcode: musician?.address?.postcode,
        neighbourCounties,
      });

      let weightRoles = desiredRoles.length ? 0.15 : 0;
      let weightGenres = genres.length ? 0.2 : 0;
      let weightLocation = 0.65;
      let weightFemaleLeadBoost = femaleLeadOnly ? 0.35 : 0;

      const femaleLeadFit = femaleLeadOnly
        ? isLeadFemaleVocalist(musician)
          ? 1
          : 0
        : 0;

      const weightTotal =
        weightRoles + weightGenres + weightLocation + weightFemaleLeadBoost;
      weightRoles /= weightTotal;
      weightGenres /= weightTotal;
      weightLocation /= weightTotal;
      weightFemaleLeadBoost /= weightTotal;

      const deputyMatchScore =
        roleFit * weightRoles +
        genreFit * weightGenres +
        locationFit * weightLocation +
        femaleLeadFit * weightFemaleLeadBoost;

      return {
        ...musician,
        femaleLeadFit,
        vocalTypes: getVocalTypes(musician),
        vocalGender: getVocalGender(musician),
        deputyMatchScore,
        deputyMatchPercent: Math.round(Math.max(0, Math.min(1, deputyMatchScore)) * 100),
      };
    })
    .sort((a, b) => b.deputyMatchScore - a.deputyMatchScore)
    .slice(0, limit);

  return filtered;
};