// controllers/actCardController.js
import ActFilterCard from "../models/ActFilterCard.js";
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



const normSize = (s='') => {
  const v = String(s).trim().toLowerCase();
  if (v === 'solo' || v === '1-piece') return 'Solo';
  if (v === 'duo' || v === '2-piece') return 'Duo';
  if (v === 'trio' || v === '3-piece') return 'Trio';
  // Keep your display labels for the rest:
  if (/4-?piece/i.test(s)) return '4-Piece';
  if (/5-?piece/i.test(s)) return '5-Piece';
  if (/6-?piece/i.test(s)) return '6-Piece';
  if (/7-?piece/i.test(s)) return '7-Piece';
  if (/8-?piece/i.test(s)) return '8-Piece';
  if (/9-?piece/i.test(s)) return '9-Piece';
  if (/10/i.test(s))      return '10-Piece +';
  return s;
};

const wirelessKey = (label='') => {
  const k = String(label).trim().toLowerCase();
  if (k.startsWith('vocal')) return 'vocal';
  if (k.includes('sax'))     return 'saxophone';
  return k; // guitar, bass, keytar, trumpet etc.
};

const normalizeExtraKey = (k='') =>
  String(k).toLowerCase().replace(/[^a-z0-9]+/g, '_');

export async function searchActCards(req, res) {
  try {
    const {
      // arrays from UI:
      genres = [],
      lineupSizes = [],
      instruments = [],
      wireless = [],
      soundLimiters = [],
      setupAndSoundcheck = [],
      paAndLights = [],
      pli = [],
      extraServices = [],
      actSearch = [],
      songSearch = [],
      // visibility gates
      includeStatuses = ["approved", "live", "approved_changes_pending", "live_changes_pending"],
      excludeTests = true,
    } = req.body || {};

    const q = { $and: [] };

    // status/isTest
    if (Array.isArray(includeStatuses) && includeStatuses.length) {
      q.$and.push({ status: { $in: includeStatuses } });
    }
    if (excludeTests) q.$and.push({ isTest: { $ne: true } });

    // genres
    if (genres.length) q.$and.push({ genres: { $in: genres } });

    // sizes
    if (lineupSizes.length) {
      const wanted = lineupSizes.map(normSize);
      q.$and.push({ lineupSizes: { $in: wanted } });
    }

    // instruments (ANY)
    if (instruments.length) q.$and.push({ instruments: { $in: instruments } });

    // wireless (ANY)
    if (wireless.length) {
      q.$and.push({
        $or: wireless.map((w) => ({ [`wirelessByInstrument.${wirelessKey(w)}`]: true })),
      });
    }

    // sound limiter toggles
    const limiterToggles = new Set(soundLimiters.filter((v) => !/\d/.test(v)));
    if (limiterToggles.has("electric_drums"))          q.$and.push({ hasElectricDrums: true });
    if (limiterToggles.has("iems"))                    q.$and.push({ hasIEMs: true });
    if (limiterToggles.has("can_you_make_act_acoustic")) q.$and.push({ canMakeAcoustic: true });
    if (limiterToggles.has("remove_drums"))            q.$and.push({ canRemoveDrums: true });

    // dB threshold: include if card.minDb <= selectedDb
    const dbNumbers = soundLimiters
      .map((v) => (v.match(/\d+/) ? Number(v.match(/\d+/)[0]) : null))
      .filter((n) => Number.isFinite(n));
    if (dbNumbers.length) {
      q.$and.push({ minDb: { $lte: Math.min(...dbNumbers) } });
    }

    // setup & soundcheck
    if (setupAndSoundcheck.includes("setup_and_soundcheck_time_60min")) q.$and.push({ setupSupports60: true });
    if (setupAndSoundcheck.includes("setup_and_soundcheck_time_90min")) q.$and.push({ setupSupports90: true });
    if (setupAndSoundcheck.includes("speedy_setup"))                    q.$and.push({ hasSpeedySetup: true });

    // PA & Lights (each block is OR; both blocks must pass if both selected)
    const paWants = paAndLights.filter((k) => /_pa_/.test(k));
    const lightWants = paAndLights.filter((k) => /_light_/.test(k));
    const paMap = { small_pa_size: "pa.small",   medium_pa_size: "pa.medium",   large_pa_size: "pa.large" };
    const ltMap = { small_light_size: "light.small", medium_light_size: "light.medium", large_light_size: "light.large" };
    if (paWants.length) q.$and.push({ $or: paWants.map((k) => ({ [paMap[k]]: true })) });
    if (lightWants.length) q.$and.push({ $or: lightWants.map((k) => ({ [ltMap[k]]: true })) });

    // PLI (acts pass if pliAmount >= MIN(selected))
    if (pli.length) q.$and.push({ pliAmount: { $gte: Math.min(...pli.map(Number)) } });

    // extra services
    if (extraServices.length) {
      const $ors = [];
      const has = (k) => $ors.push({ [`extras.${normalizeExtraKey(k)}`]: true });

      for (const k of extraServices) {
        if (k === "ceremony_solo")        $ors.push({ "ceremony.solo": true });
        else if (k === "duo_ceremony")    $ors.push({ "ceremony.duo": true });
        else if (k === "trio_ceremony")   $ors.push({ "ceremony.trio": true });
        else if (k === "four_piece_ceremony") $ors.push({ "ceremony.fourpiece": true });
        else if (k === "afternoon_solo")  $ors.push({ "afternoon.solo": true });
        else if (k === "afternoon_duo")   $ors.push({ "afternoon.duo": true });
        else if (k === "afternoon_trio")  $ors.push({ "afternoon.trio": true });
        else if (k === "afternoon_4piece")$ors.push({ "afternoon.fourpiece": true });
        else has(k); // early_arrival, late_stay, extra_song, extra_sets, add_another_vocalist, sound_engineering_for_another_act, israeli_sets, etc.
      }
      if ($ors.length) q.$and.push({ $or: $ors });
    }

    // act name search (ANY of terms)
    if (actSearch.length) {
      const terms = actSearch.filter(Boolean).map((s) => String(s).trim());
      q.$and.push({
        $or: [
          { name:   { $regex: terms.join("|"),   $options: "i" } },
          { tscName:{ $regex: terms.join("|"),   $options: "i" } },
        ],
      });
    }

    // song/artist search via tokens (ANY)
    if (songSearch.length) {
      const tokens = songSearch
        .map((s) => String(s).toLowerCase().trim())
        .filter(Boolean);
      if (tokens.length) {
        q.$and.push({
          $or: [
            { repertoireTokens: { $in: tokens } },
            { artistTokens:     { $in: tokens } },
          ],
        });
      }
    }

    // If no AND parts added, match all
    const mongo = q.$and.length ? q : {};

    const cards = await ActFilterCard.find(mongo)
      .select("_id actId status isTest")
      .lean();

    res.json({ ok: true, count: cards.length, cards });
  } catch (err) {
    console.error("searchActCards error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}