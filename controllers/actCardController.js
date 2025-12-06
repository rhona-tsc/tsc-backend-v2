
import actModel from "../models/actModel.js";

export async function getActCards(req, res) {
  try {
    const statuses = String(req.query.status || "approved,live").split(",").map((s) => s.trim());
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sort = String(req.query.sort || "-createdAt");

    const sortObj = {};
    String(sort)
      .split(",")
      .filter(Boolean)
      .forEach((k) => {
        if (k.startsWith("-")) sortObj[k.slice(1)] = -1;
        else sortObj[k] = 1;
      });

    const cards = await actModel.aggregate([
      { $match: { status: { $in: statuses } } },

      // Keep only fields we need downstream
      {
        $project: {
          actId: "$_id",
          name: 1,
          tscName: 1,
          numberOfShortlistsIn: 1,
          timesShortlisted: 1,
          availabilityBadge: 1,
          profileImage: 1,
          coverImage: 1,
          images: 1,
          lineups: 1,
          countyFees: 1,
          useCountyTravelFee: 1,
          formattedPrice: 1,
        },
      },

      // Candidate images & base_fee snapshot
      {
        $addFields: {
          _img_prof: { $first: "$profileImage" },
          _img_cover: { $first: "$coverImage" },
          _img_any: { $first: "$images" },
          _baseFees: {
            $map: {
              input: { $ifNull: ["$lineups", []] },
              as: "l",
              in: {
                $let: {
                  vars: { firstFee: { $first: "$$l.base_fee" } },
                  in: { $ifNull: ["$$firstFee.total_fee", null] },
                },
              },
            },
          },
        },
      },

      // Derive: smallest lineup bare member fee + essential roles, travel headcount, min county fee
      {
        $addFields: {
          _lineupCalc: {
            $map: {
              input: { $ifNull: ["$lineups", []] },
              as: "l",
              in: {
                membersLen: { $size: { $ifNull: ["$$l.bandMembers", []] } },
                bareFee: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$$l.bandMembers", []] },
                      as: "m",
                      in: {
                        $add: [
                          { $toDouble: { $ifNull: ["$$m.fee", 0] } },
                          {
                            $sum: {
                              $map: {
                                input: {
                                  $filter: {
                                    input: { $ifNull: ["$$m.additionalRoles", []] },
                                    as: "r",
                                    cond: { $eq: ["$$r.isEssential", true] },
                                  },
                                },
                                as: "r",
                                in: { $toDouble: { $ifNull: ["$$r.additionalFee", 0] } },
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
                travelCount: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$$l.bandMembers", []] },
                      as: "m",
                      in: {
                        $cond: [
                          {
                            $regexMatch: {
                              input: { $toString: "$$m.instrument" },
                              regex: /manager/i,
                            },
                          },
                          0,
                          1,
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          _minCountyFee: {
            $let: {
              vars: {
                arr: {
                  $map: {
                    input: { $objectToArray: { $ifNull: ["$countyFees", {}] } },
                    as: "kv",
                    in: { $toDouble: "$$kv.v" },
                  },
                },
              },
              in: {
                $min: {
                  $filter: { input: "$$arr", as: "v", cond: { $gt: ["$$v", 0] } },
                },
              },
            },
          },
          _formattedTotal: "$formattedPrice.total",
        },
      },

      // Sort lineups by (membersLen asc, bareFee asc) and pick the smallest
      {
        $addFields: {
          _sortedLineups: { $sortArray: { input: "$_lineupCalc", sortBy: { membersLen: 1, bareFee: 1 } } },
          _imageUrl: {
            $let: {
              vars: {
                cands: [
                  { $ifNull: ["$_img_prof.url", ""] },
                  { $ifNull: ["$_img_cover.url", ""] },
                  { $ifNull: ["$_img_any.url", ""] },
                ],
              },
              in: {
                $let: {
                  vars: {
                    firstNonEmpty: {
                      $first: {
                        $filter: { input: "$$cands", as: "u", cond: { $gt: ["$$u", ""] } },
                      },
                    },
                  },
                  in: { $ifNull: ["$$firstNonEmpty", ""] },
                },
              },
            },
          },
        },
      },
      { $addFields: { _smallest: { $first: "$_sortedLineups" } } },

      // Compose derived totals
      {
        $addFields: {
          _derivedBase: { $ifNull: ["$_smallest.bareFee", null] },
          _derivedTravel: {
            $multiply: [
              { $ifNull: ["$_minCountyFee", 0] },
              { $ifNull: ["$_smallest.travelCount", 0] },
            ],
          },
          loveCount: {
            $ifNull: ["$numberOfShortlistsIn", { $ifNull: ["$timesShortlisted", 0] }],
          },
        },
      },

      // Final basePrice preference:
      // 1) derived (member fees + essential roles + min county travel × non-managers)
      // 2) min base_fee.total_fee from lineups (if present)
      // 3) formattedPrice.total fallback (string like "£1200")
      {
        $addFields: {
          basePrice: {
            $ifNull: [
              { $add: ["$_derivedBase", "$_derivedTravel"] },
              {
                $min: {
                  $filter: {
                    input: { $ifNull: ["$_baseFees", []] },
                    as: "f",
                    cond: { $ne: ["$$f", null] },
                  },
                },
              },
              "$_formattedTotal",
            ],
          },
          imageUrl: "$_imageUrl",
        },
      },

      // Tidy up
      {
        $project: {
          _img_prof: 0,
          _img_cover: 0,
          _img_any: 0,
          _baseFees: 0,
          _lineupCalc: 0,
          _sortedLineups: 0,
          _smallest: 0,
          _formattedTotal: 0,
          _minCountyFee: 0,
          _derivedBase: 0,
          _derivedTravel: 0,
          profileImage: 0,
          coverImage: 0,
          images: 0,
          lineups: 0,
          countyFees: 0,
          useCountyTravelFee: 0,
          formattedPrice: 0,
        },
      },

      { $sort: sortObj },
      { $limit: limit },
    ]);

    res.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
    );
    return res.json({ success: true, acts: cards });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}