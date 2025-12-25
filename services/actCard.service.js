import actCardModel from "../models/actCard.model.js";
import { normalize } from "../utils/normalize.js";



const toNum = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const isManagerMember = (m) => /manager/i.test(String(m?.instrument || m?.role || ""));

const essentialRolesFee = (member) => {
  const roles = Array.isArray(member?.additionalRoles) ? member.additionalRoles : [];
  return roles.reduce((sum, r) => {
    if (!r?.isEssential) return sum;
    return sum + toNum(r?.additionalFee ?? r?.fee);
  }, 0);
};

const lineupBareFee = (lineup) => {
  const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
  return members.reduce((sum, m) => sum + toNum(m?.fee) + essentialRolesFee(m), 0);
};

const minCountyFee = (act) => {
  if (!(act?.useCountyTravelFee && act?.countyFees && typeof act.countyFees === "object")) return 0;
  const vals = Object.values(act.countyFees)
    .map(toNum)
    .filter((n) => Number.isFinite(n) && n > 0);
  return vals.length ? Math.min(...vals) : 0;
};

// ✅ The “source of truth” card base price
function computeCardBasePrice(act) {
  const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
  if (!lineups.length) return { basePrice: 0, breakdown: { source: "no_lineups" } };

  // smallest lineup first; tie-break cheaper
  const sorted = [...lineups].sort((a, b) => {
    const na = Array.isArray(a?.bandMembers) ? a.bandMembers.length : Number.POSITIVE_INFINITY;
    const nb = Array.isArray(b?.bandMembers) ? b.bandMembers.length : Number.POSITIVE_INFINITY;
    if (na !== nb) return na - nb;
    return lineupBareFee(a) - lineupBareFee(b);
  });

  const chosen = sorted[0];
  const members = Array.isArray(chosen?.bandMembers) ? chosen.bandMembers : [];
  const memberFees = lineupBareFee(chosen);

  const travelCount = members.reduce((n, m) => n + (isManagerMember(m) ? 0 : 1), 0);
  const travelUnit = minCountyFee(act);
  const travel = travelUnit > 0 ? travelUnit * travelCount : 0;

  const total = memberFees + travel;

  return {
    basePrice: Math.round(total),
    breakdown: { source: "derived", memberFees, travelUnit, travelCount, travel, total },
  };
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

const pickGenres = (act) => {
  // handle ["Soul & Motown", "Funk"], or [{name:"Soul & Motown"}]
  const raw = Array.isArray(act?.genres)
    ? act.genres.map((g) =>
        typeof g === "string" ? g : (g?.name || g?.label || "")
      )
    : [];
  return { raw: uniq(raw), norm: uniq(raw.map(normalize)) };
};

const pickLineupSizes = (act) => {
  // from act.lineups[].actSize / size / label (e.g., "4-Piece", "6-Piece")
  const raw = Array.isArray(act?.lineups)
    ? act.lineups
        .map((l) => l?.actSize || l?.size || l?.label || "")
        .filter(Boolean)
    : [];
  return { raw: uniq(raw), norm: uniq(raw.map(normalize)) };
};

const pickInstruments = (act) => {
  // from act.instruments or bandMembers[].instrument
  let raw = [];
  if (Array.isArray(act?.instruments) && act.instruments.length) {
    raw = act.instruments.map((v) =>
      typeof v === "string" ? v : (v?.instrument || v?.name || "")
    );
  } else if (Array.isArray(act?.bandMembers)) {
    raw = act.bandMembers
      .map((m) => m?.instrument || "")
      .filter(Boolean);
  }
  return { raw: uniq(raw), norm: uniq(raw.map(normalize)) };
};

export async function upsertActCardFromAct(act) {
  const { raw: genres,        norm: genres_norm }        = pickGenres(act);
  const { raw: lineupSizes,   norm: lineupSizes_norm }   = pickLineupSizes(act);
  const { raw: instruments,   norm: instruments_norm }   = pickInstruments(act);

  const imageUrl =
    act?.images?.[0]?.url || act?.images?.[0] || act?.heroImage || "";



  const { basePrice, breakdown } = computeCardBasePrice(act);

if (String(process.env.DEBUG_CARD_PRICING || "").toLowerCase() === "true") {
  console.log("💷[ActCard] basePrice computed", {
    actId: String(act?._id || ""),
    name: act?.tscName || act?.name,
    useCountyTravelFee: !!act?.useCountyTravelFee,
    basePrice,
    breakdown,
  });
}

  await actCardModel.findOneAndUpdate(
    { actId: act._id },
    {
      $set: {
        actId: act._id,
        name: act.name,
        tscName: act.tscName || act.name,
        slug: act.slug || "",
        status: act.status || "",

        imageUrl,
        basePrice,

        genres,
        genres_norm,
        lineupSizes,
        lineupSizes_norm,
        instruments,
        instruments_norm,
      },
    },
    { upsert: true, new: true }
  );
}
