// services/upsertActCardFromAct.js
import ActFilterCard from "../models/actFilterCard.model.js";
import { buildCard } from "./buildActFilterCard.js";

/**
 * Upserts the lightweight ActFilterCard row from a full Act document.
 * - Uses flattenMaps so Mongoose Maps (countyFees, etc.) become plain objects
 * - Ensures actId is stored as ObjectId (schema requires ObjectId)
 */
export async function upsertActCardFromAct(actDocOrObj) {
  if (!actDocOrObj) return null;

  const act =
    typeof actDocOrObj?.toObject === "function"
      ? actDocOrObj.toObject({ flattenMaps: true })
      : actDocOrObj;

  if (!act?._id) throw new Error("upsertActCardFromAct: missing act._id");

  // buildCard returns actId as string in your current service;
  // but ActFilterCardSchema expects actId as ObjectId, so we override it.
  const built = buildCard(act);

  const cardDoc = {
    ...built,
    actId: act._id, // ✅ enforce ObjectId
  };

  // Optional: if buildCard includes actId:string, remove it to avoid confusion
  delete cardDoc.actIdString;
  // (If you don’t have actIdString, no worries)

  await ActFilterCard.updateOne(
    { actId: act._id },
    {
      $set: cardDoc,
      $setOnInsert: { createdAt: new Date() },
      $currentDate: { updatedAt: true },
    },
    { upsert: true }
  );

  return cardDoc;
}