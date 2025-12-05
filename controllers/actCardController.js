// controllers/actCardsController.js
import actModel from "../models/actModel.js";

export async function getActCards(req, res) {
  try {
    const statuses = String(req.query.status || "approved,live")
      .split(",").map(s => s.trim());
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sort  = String(req.query.sort || "-createdAt");

    const sortObj = {};
    String(sort).split(",").filter(Boolean).forEach(k => {
      if (k.startsWith("-")) sortObj[k.slice(1)] = -1;
      else sortObj[k] = 1;
    });

    const cards = await actModel.aggregate([
      { $match: { status: { $in: statuses } } },

      // Project minimal fields
      {
        $project: {
          actId: "$_id",
          name: 1,
          tscName: 1,

          // loveCount from multiple possible fields
          loveCount: {
            $ifNull: [
              "$numberOfShortlistsIn",
              { $ifNull: ["$timesShortlisted", 0] }
            ]
          },

          // candidate images: profileImage[0], coverImage[0], images[0]
          _img_prof: { $first: "$profileImage" },
          _img_cover: { $first: "$coverImage" },
          _img_any: { $first: "$images" },

          // collect all base fees we can see
          _baseFees: {
            $map: {
              input: { $ifNull: ["$lineups", []] },
              as: "l",
              in: {
                $let: {
                  vars: { firstFee: { $first: "$$l.base_fee" } },
                  in: { $ifNull: ["$$firstFee.total_fee", null] }
                }
              }
            }
          },

          _formattedTotal: "$formattedPrice.total",

          // pass through (you might have a per-date map; front-end already handles fallbacks)
          availabilityBadge: 1
        }
      },

      // Resolve first non-empty image and min base price
      {
        $addFields: {
          imageUrl: {
            $let: {
              vars: {
                cands: [
                  { $ifNull: ["$_img_prof.url", ""] },
                  { $ifNull: ["$_img_cover.url", ""] },
                  { $ifNull: ["$_img_any.url", ""] }
                ]
              },
              in: {
                $let: {
                  vars: {
                    firstNonEmpty: {
                      $first: {
                        $filter: {
                          input: "$$cands",
                          as: "u",
                          cond: { $gt: ["$$u", ""] }
                        }
                      }
                    }
                  },
                  in: { $ifNull: ["$$firstNonEmpty", ""] }
                }
              }
            }
          },

          basePrice: {
            $ifNull: [
              {
                $min: {
                  $filter: {
                    input: { $ifNull: ["$_baseFees", []] },
                    as: "f",
                    cond: { $ne: ["$$f", null] }
                  }
                }
              },
              "$_formattedTotal"
            ]
          }
        }
      },

      // Clean up temps
      {
        $project: {
          _img_prof: 0, _img_cover: 0, _img_any: 0,
          _baseFees: 0, _formattedTotal: 0
        }
      },

      { $sort: sortObj },
      { $limit: limit }
    ]);

    // 1 minute browser, 5 min CDN, SWR friendly
    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return res.json({ success: true, acts: cards });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}