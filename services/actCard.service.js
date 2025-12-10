import actCardModel from "../models/actCard.model.js";
import { normalize } from "../utils/normalize.js";

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

  const basePrice = Number(
    act?.base_fee?.min ??
    act?.base_fee?.total_fee ??
    act?.base_fee ??
    0
  ) || 0;

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