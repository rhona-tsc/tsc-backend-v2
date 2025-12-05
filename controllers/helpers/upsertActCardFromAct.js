import actCardModel from "../../models/actCard.model.js";
import pickHeroImage from "../../utils/pickHeroImage.js";

// ---------- helpers ----------
export function computeSmallestLineupBase(act) {
  if (!Array.isArray(act?.lineups) || act.lineups.length === 0) return null;
  // choose by smallest size (or first) – mirror your production rule
  const sorted = [...act.lineups].sort((a, b) => (a?.size || 0) - (b?.size || 0));
  const first = sorted[0];
  const raw =
    act?.formattedPrice?.total ??
    first?.base_fee?.[0]?.total_fee ??
    null;
  if (raw == null) return null;
  return Number(String(raw).replace(/[^0-9.+-]/g, ""));
}

export async function upsertActCardFromAct(actDoc) {
  const imageUrl = pickHeroImage(actDoc); // return either absolute URL or public_id
  const basePrice = computeSmallestLineupBase(actDoc); // number or null
  const loveCount =
    Number(
      actDoc?.numberOfShortlistsIn ??
      actDoc?.shortlistCount ??
      actDoc?.metrics?.shortlists ??
      0
    ) || 0;

  await actCardModel.updateOne(
    { actId: actDoc._id },
    {
      $set: {
        tscName: actDoc.tscName || actDoc.name || "",
        name: actDoc.name || "",
        slug: actDoc.slug || "",
        imageUrl,
        basePrice,
        loveCount,
        status: actDoc.status || "pending",
        amendmentPending: !!actDoc?.amendment?.isPending,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}


