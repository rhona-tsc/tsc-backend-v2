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

const INSTRUMENT_ALIASES = {
  guitar: [
    "guitarist",
    "lead guitarist",
    "rhythm guitarist",
    "electric guitar",
    "acoustic guitar",
    "gtr",
    "lead guitar",
  ],
  guitarist: [
    "guitar",
    "lead guitarist",
    "rhythm guitarist",
    "electric guitar",
    "acoustic guitar",
    "gtr",
    "lead guitar",
  ],
  "lead guitarist": [
    "guitar",
    "guitarist",
    "lead guitar",
    "electric guitar",
    "acoustic guitar",
    "gtr",
  ],
  "lead guitar": [
    "guitar",
    "guitarist",
    "lead guitarist",
    "electric guitar",
    "acoustic guitar",
    "gtr",
  ],
  "rhythm guitarist": [
    "guitar",
    "guitarist",
    "rhythm guitar",
    "electric guitar",
    "acoustic guitar",
    "gtr",
  ],
  bass: ["bass guitar", "bassist", "electric bass"],
  bassist: ["bass", "bass guitar", "electric bass"],
  "bass guitar": ["bass", "bassist", "electric bass"],
  drums: ["drummer", "drum kit"],
  drummer: ["drums", "drum kit"],
  keys: ["keyboard", "keyboardist", "piano", "keys player"],
  keyboard: ["keys", "keyboardist", "piano", "keys player"],
  keyboardist: ["keys", "keyboard", "piano", "keys player"],
  piano: ["keys", "keyboard", "keyboardist", "pianist"],
  pianist: ["piano", "keys", "keyboard", "keyboardist"],
  sax: ["saxophone", "saxophonist"],
  saxophone: ["sax", "saxophonist"],
  saxophonist: ["sax", "saxophone"],
};

const aliasSet = new Map(
  Object.entries(ROLE_ALIASES).map(([k, arr]) => [norm(k), new Set(arr.map(norm))])
);

const instrumentAliasSet = new Map(
  Object.entries(INSTRUMENT_ALIASES).map(([k, arr]) => [
    norm(k),
    new Set(arr.map(norm)),
  ])
);

const instrumentSimilarity = (a, b) => {
  const A = norm(a);
  const B = norm(b);

  if (!A || !B) return 0;
  if (A === B) return 1;
  if (instrumentAliasSet.get(A)?.has(B) || instrumentAliasSet.get(B)?.has(A)) {
    return 1;
  }

  if (A.includes(B) || B.includes(A)) return 0.9;

  const tokensA = new Set(A.split(/[^a-z0-9]+/).filter(Boolean));
  const tokensB = new Set(B.split(/[^a-z0-9]+/).filter(Boolean));

  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }

  const jaccard = intersection / (tokensA.size + tokensB.size - intersection);
  return jaccard >= 0.5 ? 0.7 : 0;
};

const countyKey = (name = "") => String(name).toLowerCase().replace(/\s+/g, "_");

const outwardCode = (postcode = "") =>
  String(postcode || "").toUpperCase().replace(/\s+/g, "").slice(0, 3);

const countyFromPostcode = (postcode = "") => {
  const outward = outwardCode(postcode);
  if (!outward) return "";

  for (const [county, districts] of Object.entries(POSTCODE_MAP)) {
    if (
      Array.isArray(districts) &&
      districts.some((district) =>
        outward.startsWith(String(district).toUpperCase().trim()),
      )
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
    (POSTCODE_MAP[key] || []).map((value) => String(value).toUpperCase().trim()),
  );

  if (!mine.size) return [];

  const out = new Set();
  for (const [candidateCountyKey, prefixes] of Object.entries(POSTCODE_MAP)) {
    if (candidateCountyKey === key) continue;
    const overlaps = (prefixes || []).some((prefix) =>
      mine.has(String(prefix).toUpperCase().trim()),
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
    (instrument) => instrumentSimilarity(instrument, target) >= 0.7,
  );
};

const hasAnySecondary = (musician, wanted = []) => {
  if (!wanted.length) return true;
  return wanted.some((item) => hasInstrument(musician, item));
};

const getArrayValues = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;

        return (
          item?.instrument ||
          item?.role ||
          item?.skill ||
          item?.type ||
          item?.name ||
          item?.label ||
          item?.value ||
          ""
        );
      })
      .map(norm)
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map(norm).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .flatMap((item) => getArrayValues(item))
      .map(norm)
      .filter(Boolean);
  }

  return [];
};

const getMusicianSearchableText = (musician = {}) => {
  return [
    musician?.bio,
    musician?.tagLine,
    musician?.role,
    musician?.customRole,
    musician?.gender,
    musician?.vocalGender,
    musician?.vocals?.gender,
    ...(Array.isArray(musician?.genres) ? musician.genres : []),
    ...(Array.isArray(musician?.other_skills) ? musician.other_skills : []),
    ...(Array.isArray(musician?.instrumentation) ? musician.instrumentation : []),
    ...(Array.isArray(musician?.vocals?.type) ? musician.vocals.type : []),
  ]
    .flatMap((item) => {
      if (Array.isArray(item)) return item;
      if (item && typeof item === "object") return Object.values(item);
      return [item];
    })
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return (
          item?.instrument ||
          item?.role ||
          item?.skill ||
          item?.type ||
          item?.name ||
          item?.label ||
          item?.value ||
          ""
        );
      }
      return "";
    })
    .map(norm)
    .filter(Boolean)
    .join(" ");
};

const getVocalTypes = (musician) => {
  const explicitTypes = getArrayValues(musician?.vocals?.type);
  const instruments = getArrayValues(musician?.instrumentation);
  const skills = getArrayValues(musician?.other_skills);

  return Array.from(new Set([...explicitTypes, ...instruments, ...skills])).filter(
    (value) =>
      /\bvocalist\b|\bvocals\b|\bvocal\b|\bsinger\b|\blead vocalist\b|\blead vocal\b|\blead singer\b|\bbacking vocalist\b|\bbacking vocals\b|\bbacking vocal\b|\bbacking singer\b|\bbv\b|\brapper\b|\brap\b|\bmc\b|\bemcee\b/.test(
        value,
      ),
  );
};

const getVocalGender = (musician) => {
  const explicitGender = norm(
    musician?.vocals?.gender ||
      musician?.vocalGender ||
      musician?.gender ||
      musician?.basicInfo?.gender ||
      "",
  );

  if (explicitGender) return explicitGender;

  const searchable = [
    ...getArrayValues(musician?.vocals?.type),
    ...getArrayValues(musician?.instrumentation),
    ...getArrayValues(musician?.other_skills),
  ].join(" ");

  if (/\bfemale\b/.test(searchable)) return "female";
  if (/\bmale\b/.test(searchable)) return "male";

  return "";
};

const hasFemaleSignal = (musician = {}) => {
  const explicitGender = getVocalGender(musician);
  if (explicitGender === "female") return true;

  const searchable = getMusicianSearchableText(musician);
  return /\bfemale\b|\bwoman\b|\blady\b|\bgirl\b/.test(searchable);
};

const hasMaleSignal = (musician = {}) => {
  const explicitGender = getVocalGender(musician);
  if (explicitGender === "male") return true;

  const searchable = getMusicianSearchableText(musician);
  return /\bmale\b|\bman\b|\bguy\b|\bboy\b/.test(searchable);
};

const wantsFemaleJob = (value = "") => /\bfemale\b/.test(norm(value));
const wantsMaleJob = (value = "") => /\bmale\b/.test(norm(value));

const getRequestedVocalGender = (instrument = "") => {
  const target = norm(instrument);
  if (wantsFemaleJob(target)) return "female";
  if (wantsMaleJob(target)) return "male";
  return "";
};

const matchesRequestedGender = (musician, requestedGender = "") => {
  if (!requestedGender) return true;

  if (requestedGender === "female") {
    return !hasMaleSignal(musician);
  }

  if (requestedGender === "male") {
    return !hasFemaleSignal(musician);
  }

  return true;
};

const wantsLeadVocalist = (instrument = "") => {
  const target = norm(instrument);

  return (
    target.includes("lead vocalist") ||
    target.includes("lead vocal") ||
    target.includes("lead singer") ||
    target.includes("lead male vocalist") ||
    target.includes("lead female vocalist") ||
    /\blead\b/.test(target)
  );
};

const wantsGuitar = (instrument = "") => norm(instrument).includes("guitar");

const wantsVocalistInstrumentalist = (instrument = "") => {
  const target = norm(instrument);
  return (
    /vocalist[-\s]*instrumentalist/.test(target) ||
    /singer[-\s]*instrumentalist/.test(target) ||
    (wantsLeadVocalist(target) && wantsGuitar(target))
  );
};

const isLeadVocalist = (musician) => {
  const vocalTypes = getVocalTypes(musician);

  return vocalTypes.some(
    (type) =>
      type.includes("lead vocalist") ||
      type.includes("lead vocal") ||
      type.includes("lead singer") ||
      type.includes("female lead vocalist") ||
      type.includes("male lead vocalist"),
  );
};

const isLeadVocalistInstrumentalist = (musician, requiredInstrument = "") => {
  if (!isLeadVocalist(musician)) return false;
  if (!requiredInstrument) return true;
  return hasInstrument(musician, requiredInstrument);
};

const isLeadFemaleVocalist = (musician) =>
  isLeadVocalist(musician) && matchesRequestedGender(musician, "female");

const wantsFemaleLeadVocalist = (instrument = "") =>
  wantsFemaleJob(instrument) && wantsLeadVocalist(instrument);

const isVocalist = (musician) => {
  const vocalTypes = getVocalTypes(musician);

  if (vocalTypes.length) return true;

  const instruments = getArrayValues(musician?.instrumentation);
  if (
    instruments.some((instrument) =>
      /\bvocalist\b|\bvocals\b|\bvocal\b|\bsinger\b|\brapper\b|\brap\b|\bmc\b|\bemcee\b/.test(
        instrument,
      ),
    )
  ) {
    return true;
  }

  const rapValue = String(musician?.vocals?.rap ?? "").toLowerCase();
  if (rapValue === "true" || rapValue === "yes") return true;

  const skills = getArrayValues(musician?.other_skills);
  return skills.some((skill) =>
    /\bbacking vocalist\b|\bbacking vocals\b|\bbacking vocal\b|\bbacking singer\b|\bbv\b|\bvocalist\b|\bvocals\b|\bvocal\b|\bsinger\b|\brapper\b|\brap\b|\bmc\b|\bemcee\b/.test(
      skill,
    ),
  );
};

const hasAllEssentialRoles = (musician, essentialRoles = []) => {
  if (!essentialRoles.length) return true;

  const searchableRoles = Array.from(
    new Set([
      ...getArrayValues(musician?.other_skills),
      ...getArrayValues(musician?.instrumentation),
      ...getVocalTypes(musician),
    ]),
  );

  return essentialRoles.every((requiredRole) => {
    const wanted = norm(requiredRole);
    if (!wanted) return true;

    if (/backing\s*voc|backing vocalist|bv/.test(wanted)) {
      return searchableRoles.some((type) =>
        /backing\s*voc|backing vocalist|bv|lead\s*voc|lead vocalist|lead singer|vocalist|singer/.test(
          type,
        ),
      );
    }

    return searchableRoles.some(
      (existingRole) => roleSimilarity(existingRole, requiredRole) >= 0.6,
    );
  });
};

const desiredRoleScore = (musician, desiredRoles = []) => {
  if (!desiredRoles.length) return 0;

  const skills = Array.from(
    new Set([
      ...getArrayValues(musician?.other_skills),
      ...getArrayValues(musician?.instrumentation),
      ...getVocalTypes(musician),
    ]),
  );

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
  limit = null,
}) => {
  const pool = await musicianModel
    .find({
      role: "musician",
      ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
    })
    .lean();

  const resolvedCounty = county || countyFromPostcode(postcode);
  const neighbourCounties = neighboursForCounty(resolvedCounty);
  const requestedGender = getRequestedVocalGender(instrument);
  const femaleLeadOnly = wantsFemaleLeadVocalist(instrument);
  const leadOnly = wantsLeadVocalist(instrument);
  const vocalistInstrumentalistOnly = wantsVocalistInstrumentalist(instrument);
  const requiredInstrumentForVocalist = wantsGuitar(instrument) ? "guitar" : "";

  const filtered = pool
    .filter((musician) => {
      if (!hasAllEssentialRoles(musician, essentialRoles)) return false;

      if (isVocalSlot) {
        if (!matchesRequestedGender(musician, requestedGender)) return false;

        if (femaleLeadOnly) {
          if (!isVocalist(musician)) return false;
        } else if (vocalistInstrumentalistOnly) {
          if (
            !isLeadVocalistInstrumentalist(
              musician,
              requiredInstrumentForVocalist,
            )
          ) {
            return false;
          }
        } else if (leadOnly) {
          if (!isVocalist(musician)) return false;
        } else if (!isVocalist(musician)) {
          return false;
        }
      } else {
        if (!matchesRequestedGender(musician, requestedGender)) return false;
        if (!hasInstrument(musician, instrument)) return false;
      }

      if (!hasAnySecondary(musician, secondaryInstruments)) return false;

      return true;
    })
    .map((musician) => {
      const roleFit = desiredRoleScore(musician, desiredRoles);
      const genreFit = genreScore(musician, genres);
      const instrumentFit = isVocalSlot
        ? isVocalist(musician)
          ? 1
          : 0
        : hasInstrument(musician, instrument)
          ? 1
          : 0;

      const locationFit = scoreLocation({
        targetCounty: resolvedCounty,
        targetPostcode: postcode,
        musicianCounty:
          musician?.address?.county ||
          countyFromPostcode(musician?.address?.postcode),
        musicianPostcode: musician?.address?.postcode,
        neighbourCounties,
      });

      let weightInstrument = instrument ? 0.35 : 0;
      let weightRoles = desiredRoles.length ? 0.1 : 0;
      let weightGenres = genres.length ? 0.15 : 0;
      let weightLocation = 0.4;
      let weightFemaleLeadBoost =
        femaleLeadOnly || requestedGender ? 0.2 : 0;

      const femaleLeadFit = femaleLeadOnly
        ? matchesRequestedGender(musician, "female") && isVocalist(musician)
          ? 1
          : 0
        : requestedGender
          ? matchesRequestedGender(musician, requestedGender)
            ? 1
            : 0
          : 0;

      const weightTotal =
        weightInstrument +
        weightRoles +
        weightGenres +
        weightLocation +
        weightFemaleLeadBoost;

      weightInstrument /= weightTotal;
      weightRoles /= weightTotal;
      weightGenres /= weightTotal;
      weightLocation /= weightTotal;
      weightFemaleLeadBoost /= weightTotal;

      const deputyMatchScore =
        instrumentFit * weightInstrument +
        roleFit * weightRoles +
        genreFit * weightGenres +
        locationFit * weightLocation +
        femaleLeadFit * weightFemaleLeadBoost;

      return {
        ...musician,
        instrumentFit,
        femaleLeadFit,
        requestedGender,
        leadOnly,
        vocalistInstrumentalistOnly,
        vocalTypes: getVocalTypes(musician),
        vocalGender: getVocalGender(musician),
        deputyMatchScore,
        deputyMatchPercent: Math.round(
          Math.max(0, Math.min(1, deputyMatchScore)) * 100,
        ),
      };
    })
   .sort((a, b) => b.deputyMatchScore - a.deputyMatchScore);

const finalResults = limit ? filtered.slice(0, limit) : filtered;

  console.log("🎯 deputy matcher results", {
    instrument,
    isVocalSlot,
    requestedGender,
    femaleLeadOnly,
    leadOnly,
    vocalistInstrumentalistOnly,
    poolCount: pool.length,
    filteredCount: filtered.length,
    firstMatches: filtered.slice(0, 10).map((musician) => ({
      id: musician?._id,
      firstName: musician?.firstName || musician?.basicInfo?.firstName || "",
      lastName: musician?.lastName || musician?.basicInfo?.lastName || "",
      email: musician?.email || musician?.basicInfo?.email || "",
      vocalGender: musician?.vocalGender,
      vocalTypes: musician?.vocalTypes,
      deputyMatchPercent: musician?.deputyMatchPercent,
    })),
  });

  return finalResults;
};