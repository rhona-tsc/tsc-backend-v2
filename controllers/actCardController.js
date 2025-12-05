// controllers/actCardsController.js
import actModel from "../models/actModel.js";

export async function getActCards(req, res) {
  try {
    const statuses = String(req.query.status || "approved,live")
      .split(",").map(s => s.trim());
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sort  = String(req.query.sort || "-createdAt");
    const sortObj = sort.startsWith("-") ? { [sort.slice(1)]: -1 } : { [sort]: 1 };

    const cards = await actModel.aggregate([
      { $match: { status: { $in: statuses } } },
      {
        $project: {
          actId: "$_id",
          name:  1,
          tscName: 1,
          loveCount: { $ifNull: ["$numberOfShortlistsIn", 0] },
          imageUrl: {
            $ifNull: [
              { $getField: { field: "url", input: { $first: "$profileImage" } } },
              ""
            ]
          },
          basePrice: {
            $ifNull: [
              "$formattedPrice.total",
              {
                $let: {
                  vars: { bf: { $first: "$lineups.base_fee" } },
                  in: { $getField: { field: "total_fee", input: { $first: "$$bf" } } }
                }
              }
            ]
          },
          availabilityBadge: 1
        }
      },
      { $sort: sortObj },
      { $limit: limit }
    ]);

    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return res.json({ success: true, acts: cards });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}