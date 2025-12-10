// controllers/helpers/upsertActCardFromAct.js
import ActCard from "../../models/actCard.model.js";
import { buildCard } from "../../services/buildActFilterCard.js";
import { normalizeActCard } from "../../services/normalizeActCard.js";

export async function upsertActCardFromAct(input) {
  const act = input?.toObject ? input.toObject({ depopulate: true }) : (input || {});
  const raw = buildCard(act);
  const card = normalizeActCard(raw, act);

  await ActCard.updateOne(
    { actId: card.actId },
    { $set: card },
    { upsert: true }
  );

  return card;
}