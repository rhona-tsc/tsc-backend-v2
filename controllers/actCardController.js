// controllers/actCardController.js
import ActFilterCard from "../models/ActFilterCard.js";
import actModel from "../models/actModel.js";

/* -------------------------- helpers / constants -------------------------- */

const APPROVED_LIKE = [
  "approved",
  "live",
  "approved_changes_pending",
  "live_changes_pending",
];

const normSize = (s = "") => {
  const v = String(s).trim().toLowerCase();
  if (v === "solo" || v === "1-piece") return "Solo";
  if (v === "duo" || v === "2-piece") return "Duo";
  if (/3-?piece/i.test(s)) return "3-Piece";
  if (/4-?piece/i.test(s)) return "4-Piece";
  if (/5-?piece/i.test(s)) return "5-Piece";
  if (/6-?piece/i.test(s)) return "6-Piece";
  if (/7-?piece/i.test(s)) return "7-Piece";
  if (/8-?piece/i.test(s)) return "8-Piece";
  if (/9-?piece/i.test(s)) return "9-Piece";
  if (/10/i.test(s)) return "10-Piece +";
  return s;
};

const wirelessKey = (label = "") => {
  const k = String(label).trim().toLowerCase();
  if (k.startsWith("vocal")) return "vocal";
  if (k.includes("sax")) return "saxophone";
  return k; // guitar, bass, keytar, trumpet etc.
};

const normalizeExtraKey = (k = "") =>
  String(k).toLowerCase().replace(/[^a-z0-9]+/g, "_");

/* -------------------------------- getActCards ---------------------------- */
/* Returns cards with extra fields needed for client-side filters */
export async function getActCards(req, res) {
  try {
    const statuses = String(req.query.status || "approved,live")
      .split(",")
      .map((s) => s.trim());

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

      // ✅ Include both possible schema names so we can normalize later
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
          minDisplayPrice: 1,
extras: 1,
          createdAt: 1,
          updatedAt: 1,
          bestseller: 1,

          loveCount: {
            $ifNull: [
              "$loveCount",
              { $ifNull: ["$timesShortlisted", { $ifNull: ["$numberOfShortlistsIn", 0] }] },
            ],
          },

          // 👇 IMPORTANT: your cards currently have none of these
          genres: 1,
          genre: 1,                 // ✅ add
          instruments: 1,
          instrumentation: 1,       // ✅ add

          vocalist: 1,              // ✅ add
          leadVocalist: 1,          // ✅ add
          leadRole: 1,              // ✅ add

          lineupSizes: 1,
          pliAmount: 1,
          pa: 1,
          light: 1,
          status: 1,
          isTest: 1,
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

      // ✅ Normalize genres + instruments so frontend always gets arrays
      {
        $addFields: {
          _genresRaw: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$genres", []] } }, 0] },
              "$genres",
              { $ifNull: ["$genre", []] },
            ],
          },
          _instrumentsRaw: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$instruments", []] } }, 0] },
              "$instruments",
              { $ifNull: ["$instrumentation", []] },
            ],
          },

          genres: {
            $cond: [
              { $isArray: "$_genresRaw" },
              "$_genresRaw",
              {
                $cond: [
                  { $and: [{ $ne: ["$_genresRaw", null] }, { $ne: ["$_genresRaw", ""] }] },
                  {
                    $map: {
                      input: { $split: [{ $toString: "$_genresRaw" }, ","] },
                      as: "g",
                      in: { $trim: { input: "$$g" } },
                    },
                  },
                  [],
                ],
              },
            ],
          },

          instruments: {
            $cond: [
              { $isArray: "$_instrumentsRaw" },
              "$_instrumentsRaw",
              {
                $cond: [
                  { $and: [{ $ne: ["$_instrumentsRaw", null] }, { $ne: ["$_instrumentsRaw", ""] }] },
                  {
                    $map: {
                      input: { $split: [{ $toString: "$_instrumentsRaw" }, ","] },
                      as: "i",
                      in: { $trim: { input: "$$i" } },
                    },
                  },
                  [],
                ],
              },
            ],
          },
        },
      },

      // ✅ Derive leadRole from smallest lineup (so vocalist-guitarist works)
      {
        $addFields: {
          _lineupsWithSize: {
            $map: {
              input: { $ifNull: ["$lineups", []] },
              as: "l",
              in: {
                lineup: "$$l",
                membersLen: { $size: { $ifNull: ["$$l.bandMembers", []] } },
              },
            },
          },
          _sortedLineupDocs: {
            $sortArray: { input: "$_lineupsWithSize", sortBy: { membersLen: 1 } },
          },
          _smallestLineupDoc: { $first: "$_sortedLineupDocs" },
        },
      },

      {
        $addFields: {
          _membersSmallest: { $ifNull: ["$_smallestLineupDoc.lineup.bandMembers", []] },

          // Any vocalist?
          _vocalists: {
            $filter: {
              input: { $ifNull: ["$_smallestLineupDoc.lineup.bandMembers", []] },
              as: "m",
              cond: {
                $regexMatch: {
                  input: {
                    $toLower: {
                      $toString: {
                        $ifNull: [
                          "$$m.customRole",
                          { $ifNull: ["$$m.role", { $ifNull: ["$$m.instrument", ""] }] },
                        ],
                      },
                    },
                  },
                  regex: /vocal|singer/,
                },
              },
            },
          },
        },
      },

      {
        $addFields: {
          _bestVocalist: {
            $let: {
              vars: {
                compoundVocals: {
                  $filter: {
                    input: "$_vocalists",
                    as: "m",
                    cond: {
                      $regexMatch: {
                        input: {
                          $toLower: {
                            $toString: {
                              $ifNull: [
                                "$$m.customRole",
                                { $ifNull: ["$$m.role", { $ifNull: ["$$m.instrument", ""] }] },
                              ],
                            },
                          },
                        },
                        regex: /guitar|gtr|keys|keyboard|piano|dj|sax|trumpet|violin|perc|bongos/,
                      },
                    },
                  },
                },
              },
              in: {
                $ifNull: [
                  { $first: "$$compoundVocals" },
                  { $ifNull: [{ $first: "$_vocalists" }, { $first: "$_membersSmallest" }] },
                ],
              },
            },
          },
        },
      },

      {
        $addFields: {
          _bestRoleStr: {
            $trim: {
              input: {
                $toString: {
                  $ifNull: [
                    "$_bestVocalist.customRole",
                    { $ifNull: ["$_bestVocalist.role", { $ifNull: ["$_bestVocalist.instrument", ""] }] },
                  ],
                },
              },
            },
          },

          // Only set derived leadRole if explicit leadRole is missing/blank
          leadRole: {
            $let: {
              vars: {
                explicit: { $trim: { input: { $toString: { $ifNull: ["$leadRole", ""] } } } },
                best: { $toLower: "$_bestRoleStr" },
              },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: "$$explicit" }, 0] },
                  "$$explicit",
                  {
                    $cond: [
                      {
                        $and: [
                          { $regexMatch: { input: "$$best", regex: /vocal|singer/ } },
                          { $regexMatch: { input: "$$best", regex: /guitar|gtr/ } },
                        ],
                      },
                      "Vocalist-Guitarist",
                      {
                        $cond: [
                          { $regexMatch: { input: "$$best", regex: /vocal|singer/ } },
                          "Vocalist",
                          "",
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },

          // Also set a simple vocalist flag if you want (optional but helpful)
          vocalist: {
            $let: {
              vars: {
                explicitV: { $trim: { input: { $toString: { $ifNull: ["$vocalist", ""] } } } },
              },
              in: {
                $cond: [
                  { $gt: [{ $strLenCP: "$$explicitV" }, 0] },
                  "$$explicitV",
                  {
                    $cond: [{ $gt: [{ $size: "$_vocalists" }, 0] }, "Vocalist", ""],
                  },
                ],
              },
            },
          },
        },
      },

      // --- Your existing fee/travel logic unchanged ---
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

      {
        $addFields: {
          _sortedLineups: {
            $sortArray: { input: "$_lineupCalc", sortBy: { membersLen: 1, bareFee: 1 } },
          },
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
                        $filter: {
                          input: "$$cands",
                          as: "u",
                          cond: { $gt: ["$$u", ""] },
                        },
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

      // 🔗 Pull filter-card fields (extras / DJ services / normalized arrays) so client-side filters work
      {
        $lookup: {
          from: ActFilterCard.collection.name,
          localField: "actId",
          foreignField: "actId",
          as: "_filterCard",
        },
      },
      { $addFields: { _filterCard: { $first: "$_filterCard" } } },
      {
        $addFields: {
          // Prefer act fields if present, otherwise fall back to ActFilterCard
          genres: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$genres", []] } }, 0] },
              "$genres",
              { $ifNull: ["$_filterCard.genres", []] },
            ],
          },
          instruments: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$instruments", []] } }, 0] },
              "$instruments",
              { $ifNull: ["$_filterCard.instruments", []] },
            ],
          },
          lineupSizes: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$lineupSizes", []] } }, 0] },
              "$lineupSizes",
              { $ifNull: ["$_filterCard.lineupSizes", []] },
            ],
          },

          // Ensure `extras` is present (many client filters depend on this)
          extras: {
            $cond: [
              {
                $gt: [
                  {
                    $size: {
                      $objectToArray: {
                        $ifNull: ["$extras", {}],
                      },
                    },
                  },
                  0,
                ],
              },
              "$extras",
              { $ifNull: ["$_filterCard.extras", {}] },
            ],
          },

     

          // Other fields sometimes used by filters
          pliAmount: { $ifNull: ["$pliAmount", "$_filterCard.pliAmount"] },
          pa: { $ifNull: ["$pa", "$_filterCard.pa"] },
          light: { $ifNull: ["$light", "$_filterCard.light"] },
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
          _lineupsWithSize: 0,
          _sortedLineupDocs: 0,
          _smallestLineupDoc: 0,
          _membersSmallest: 0,
          _vocalists: 0,
          _bestVocalist: 0,
          _bestRoleStr: 0,
          _genresRaw: 0,
          _instrumentsRaw: 0,

          profileImage: 0,
          coverImage: 0,
          images: 0,
          lineups: 0,
          countyFees: 0,
          useCountyTravelFee: 0,
          formattedPrice: 0,

          // optional: you can also hide raw schema names if you want
          genre: 0,
          instrumentation: 0,
          _filterCard: 0,
        },
      },

      { $sort: sortObj },
      { $limit: limit },
    ]);

    // 🔧 Normalize + tag vocalist roles so instrument filters like
    // "Male Vocalist" and "MC/Rapper" work even when the raw role is
    // "Lead Male Vocal / Rapper".
    const splitInstrumentParts = (val) => {
      const parts = [];
      const push = (s) => {
        const t = String(s || "").trim();
        if (!t) return;
        // Some cards store instruments as one big string using pipes.
        // Split on pipes first, then commas.
        t.split("|").forEach((chunk) => {
          String(chunk)
            .split(",")
            .forEach((c) => {
              const u = String(c || "").trim();
              if (u) parts.push(u);
            });
        });
      };
      if (Array.isArray(val)) val.forEach(push);
      else push(val);
      return parts;
    };

    const deriveVocalTags = (parts) => {
      const tags = new Set();
      const lower = (parts || []).map((p) => String(p).toLowerCase());
      const has = (re) => lower.some((p) => re.test(p));

      if (has(/vocal|singer/)) tags.add("Vocalist");
      if (has(/(lead\s*)?male\s*(vocal|singer)|male\s*lead\s*(vocal|singer)/))
        tags.add("Male Vocalist");
      if (has(/(lead\s*)?female\s*(vocal|singer)|female\s*lead\s*(vocal|singer)/))
        tags.add("Female Vocalist");
      if (has(/\bmc\b|m\/?c|rapper/)) tags.add("MC/Rapper");

      return Array.from(tags);
    };

    for (const c of cards) {
      const parts = splitInstrumentParts(c?.instruments);
      const tags = deriveVocalTags(parts);
      // Preserve original parts but add the normalized tags.
      const merged = Array.from(new Set([...(parts || []), ...(tags || [])])).filter(Boolean);
      if (merged.length) c.instruments = merged;
    }

    res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return res.json({ success: true, acts: cards });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
/* ------------------------------ searchActCards --------------------------- */
/* Uses an aggregation so we can FLATTEN nested genre arrays and match them */
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
      djServices = [],
      paAndLights = [],
      pli = [],
      extraServices = [],
      actSearch = [],
      songSearch = [],
      // visibility gates
      includeStatuses = APPROVED_LIKE,
      excludeTests = true,
    } = req.body || {};

    // Optional debug logging (enable with ?debug=1 or body.debug=1)
    const debug = String(req.query?.debug || req.body?.debug || "") === "1";

    if (debug) {
      console.log("🧾 [searchActCards] DEBUG payload", {
        genres,
        lineupSizes,
        instruments,
        wireless,
        soundLimiters,
        setupAndSoundcheck,
        djServices,
        paAndLights,
        pli,
        extraServices,
        actSearch,
        songSearch,
        includeStatuses,
        excludeTests,
      });
    }

    /* ----------------------------- base $match ---------------------------- */
    const and = [];

    if (Array.isArray(includeStatuses) && includeStatuses.length) {
      and.push({ status: { $in: includeStatuses } });
    }
    if (excludeTests) and.push({ isTest: { $ne: true } });

    // sizes
    if (lineupSizes?.length) {
      and.push({ lineupSizes: { $in: lineupSizes.map(normSize) } });
    }

    // instruments (ANY) — supports category labels like "Male Vocalist" / "MC/Rapper"
    // by matching common synonyms inside stored instrument strings (e.g. "Lead Male Vocal / Rapper").
    if (instruments?.length) {
      const want = instruments
        .map((s) => String(s || "").trim())
        .filter(Boolean);

      const ors = [];

      for (const sel of want) {
        const k = sel.toLowerCase();

        // Male vocalist
        if (k === "male vocalist" || k === "male vocal" || k === "lead male vocal") {
          ors.push({
            instruments: {
              $regex: /(lead\s*)?male\s*(vocal|singer)|male\s*lead\s*(vocal|singer)/i,
            },
          });
          continue;
        }

        // Female vocalist
        if (k === "female vocalist" || k === "female vocal" || k === "lead female vocal") {
          ors.push({
            instruments: {
              $regex: /(lead\s*)?female\s*(vocal|singer)|female\s*lead\s*(vocal|singer)/i,
            },
          });
          continue;
        }

        // Rapper / MC
        if (k === "mc/rapper" || k === "rapper" || k === "mc") {
          ors.push({
            instruments: {
              $regex: /(\bmc\b|m\/?c|rapper)/i,
            },
          });
          continue;
        }

        // Generic vocalist
        if (k === "vocalist" || k === "singer") {
          ors.push({
            instruments: {
              $regex: /(vocal|singer)/i,
            },
          });
          continue;
        }

        // Default: exact match against array elements
        ors.push({ instruments: sel });
      }

      if (ors.length) and.push({ $or: ors });
    }

    // snapshot of AND conditions before DJ filter
    const andBeforeDj = [...and];

    const asStringArray = (v) => {
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
      if (typeof v === "string") {
        // allow JSON string arrays OR comma-separated strings
        const s = v.trim();
        if (!s) return [];
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed))
            return parsed.map((x) => String(x).trim()).filter(Boolean);
        } catch (_) {}
        return s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
      return [];
    };

    // Accept either `djServices` (preferred) or legacy `dj_services`
    const djSelRaw = asStringArray(djServices).length
      ? asStringArray(djServices)
      : asStringArray(req.body?.dj_services);

    const djSel = djSelRaw.map((s) => String(s || "").trim()).filter(Boolean);

    if (debug) {
      console.log("🎛️ [searchActCards] DJ selection", { djSelRaw, djSel });
    }

    // Mirrors the frontend `hasExtra` idea: treat an extra as enabled if it's:
    // - boolean true
    // - a positive number
    // - an object with { enabled: true } or { price/amount > 0 } or { complimentary: true }
    const buildExtraEnabledOrs = (basePath) => [
      { [basePath]: true },
      { [basePath]: { $gt: 0 } },
      { [`${basePath}.enabled`]: true },
      { [`${basePath}.isEnabled`]: true },
      { [`${basePath}.complimentary`]: true },
      { [`${basePath}.isComplimentary`]: true },
      { [`${basePath}.price`]: { $gt: 0 } },
      { [`${basePath}.amount`]: { $gt: 0 } },
    ];

    if (djSel.length) {
      const ors = [];

      if (debug) {
        console.log("🧩 [searchActCards] Building DJ OR clauses", { djSel });
      }

      // If you also store DJ services in arrays on the card
      ors.push({ djServices: { $in: djSel } });
      ors.push({ dj_services: { $in: djSel } });
      ors.push({ djServiceOptions: { $in: djSel } });

      // Extras: try raw + lowercase + normalized key variants
      for (const k of djSel) {
        const candidates = Array.from(
          new Set([
            k,
            k.toLowerCase(),
            normalizeExtraKey(k),
            normalizeExtraKey(k.toLowerCase()),
          ])
        ).filter(Boolean);

        if (debug) {
          console.log("🔑 [searchActCards] DJ key candidates", { k, candidates });
        }

        for (const c of candidates) {
          const basePath = `extras.${c}`;
          ors.push(...buildExtraEnabledOrs(basePath));
        }
      }

      if (debug) {
        console.log("🧮 [searchActCards] DJ OR clauses count", { count: ors.length });
      }

      and.push({ $or: ors });
    }

    /* ---------------------------------------------------------------------- */

    // wireless (ANY)
    if (wireless?.length) {
      and.push({
        $or: wireless.map((w) => ({
          [`wirelessByInstrument.${wirelessKey(w)}`]: true,
        })),
      });
    }

    // sound limiter toggles
    const limiterToggles = new Set(
      (soundLimiters || []).filter((v) => !/\d/.test(v))
    );
    if (limiterToggles.has("electric_drums")) and.push({ hasElectricDrums: true });
    if (limiterToggles.has("iems")) and.push({ hasIEMs: true });
    if (limiterToggles.has("can_you_make_act_acoustic"))
      and.push({ canMakeAcoustic: true });
    if (limiterToggles.has("remove_drums")) and.push({ canRemoveDrums: true });

    // dB threshold: include if card.minDb <= selectedDb
    const dbNumbers = (soundLimiters || [])
      .map((v) => (v.match(/\d+/) ? Number(v.match(/\d+/)[0]) : null))
      .filter((n) => Number.isFinite(n));
    if (dbNumbers.length) {
      and.push({ minDb: { $lte: Math.min(...dbNumbers) } });
    }

    // setup & soundcheck
    if (setupAndSoundcheck.includes("setup_and_soundcheck_time_60min"))
      and.push({ setupSupports60: true });
    if (setupAndSoundcheck.includes("setup_and_soundcheck_time_90min"))
      and.push({ setupSupports90: true });
    if (setupAndSoundcheck.includes("speedy_setup"))
      and.push({ hasSpeedySetup: true });

    // PA & Lights (each block is OR; both blocks must pass if both selected)
    const paWants = (paAndLights || []).filter((k) => /_pa_/.test(k));
    const lightWants = (paAndLights || []).filter((k) => /_light_/.test(k));
    const paMap = {
      small_pa_size: "pa.small",
      medium_pa_size: "pa.medium",
      large_pa_size: "pa.large",
    };
    const ltMap = {
      small_light_size: "light.small",
      medium_light_size: "light.medium",
      large_light_size: "light.large",
    };
    if (paWants.length)
      and.push({ $or: paWants.map((k) => ({ [paMap[k]]: true })) });
    if (lightWants.length)
      and.push({ $or: lightWants.map((k) => ({ [ltMap[k]]: true })) });

    // PLI (acts pass if pliAmount >= MIN(selected))
    if (pli?.length) and.push({ pliAmount: { $gte: Math.min(...pli.map(Number)) } });

    // extra services
    if (extraServices?.length) {
      const $ors = [];
      const has = (k) => $ors.push({ [`extras.${normalizeExtraKey(k)}`]: true });
      for (const k of extraServices) {
        if (k === "ceremony_solo") $ors.push({ "ceremony.solo": true });
        else if (k === "duo_ceremony") $ors.push({ "ceremony.duo": true });
        else if (k === "trio_ceremony") $ors.push({ "ceremony.trio": true });
        else if (k === "four_piece_ceremony")
          $ors.push({ "ceremony.fourpiece": true });
        else if (k === "afternoon_solo") $ors.push({ "afternoon.solo": true });
        else if (k === "afternoon_duo") $ors.push({ "afternoon.duo": true });
        else if (k === "afternoon_trio") $ors.push({ "afternoon.trio": true });
        else if (k === "afternoon_4piece")
          $ors.push({ "afternoon.fourpiece": true });
        else has(k);
      }
      if ($ors.length) and.push({ $or: $ors });
    }

    // act name search (ANY of terms)
    if (actSearch?.length) {
      const terms = actSearch.filter(Boolean).map((s) => String(s).trim());
      if (terms.length) {
        and.push({
          $or: [
            { name: { $regex: terms.join("|"), $options: "i" } },
            { tscName: { $regex: terms.join("|"), $options: "i" } },
          ],
        });
      }
    }

    // song/artist search via tokens (ANY)
    if (songSearch?.length) {
      const tokens = songSearch
        .map((s) => String(s).toLowerCase().trim())
        .filter(Boolean);
      if (tokens.length) {
        and.push({
          $or: [
            { repertoireTokens: { $in: tokens } },
            { artistTokens: { $in: tokens } },
          ],
        });
      }
    }

    /* --------------------------- build aggregation ------------------------ */
    const pipeline = [];

    // base match
    pipeline.push({ $match: and.length ? { $and: and } : {} });

    if (debug) {
      const matchNoDj = andBeforeDj.length ? { $and: andBeforeDj } : {};
      const matchWithDj = and.length ? { $and: and } : {};

      const sampleNoDj = await ActFilterCard.findOne(matchNoDj)
        .select({
          _id: 1,
          actId: 1,
          name: 1,
          tscName: 1,
          status: 1,
          extras: 1,
          genres: 1,
          instruments: 1,
          lineupSizes: 1,
          djServices: 1,
          dj_services: 1,
          djServiceOptions: 1,
        })
        .lean();

      const sampleWithDj = await ActFilterCard.findOne(matchWithDj)
        .select({
          _id: 1,
          actId: 1,
          name: 1,
          tscName: 1,
          status: 1,
          extras: 1,
          djServices: 1,
          dj_services: 1,
          djServiceOptions: 1,
        })
        .lean();

      console.log("🧪 [searchActCards] Sample (no DJ filter)", {
        hasSample: !!sampleNoDj,
        id: sampleNoDj?._id,
        actId: sampleNoDj?.actId,
        name: sampleNoDj?.name || sampleNoDj?.tscName,
        keys: sampleNoDj ? Object.keys(sampleNoDj) : [],
        extrasKeys: sampleNoDj?.extras ? Object.keys(sampleNoDj.extras) : [],
        djServices: sampleNoDj?.djServices,
        dj_services: sampleNoDj?.dj_services,
        djServiceOptions: sampleNoDj?.djServiceOptions,
      });

      console.log("🧪 [searchActCards] Sample (WITH DJ filter)", {
        hasSample: !!sampleWithDj,
        id: sampleWithDj?._id,
        actId: sampleWithDj?.actId,
        name: sampleWithDj?.name || sampleWithDj?.tscName,
        extrasKeys: sampleWithDj?.extras ? Object.keys(sampleWithDj.extras) : [],
        djServices: sampleWithDj?.djServices,
        dj_services: sampleWithDj?.dj_services,
        djServiceOptions: sampleWithDj?.djServiceOptions,
      });

      // If nothing matches with DJ filter, check whether the collection even stores extras at all
      if (!sampleWithDj) {
        const anyExtras = await ActFilterCard.findOne({ extras: { $exists: true } })
          .select({
            _id: 1,
            actId: 1,
            name: 1,
            tscName: 1,
            extras: 1,
            djServices: 1,
            dj_services: 1,
            djServiceOptions: 1,
          })
          .lean();

        console.log("🧯 [searchActCards] No matches w/ DJ filter — sanity check any extras exist", {
          hasAny: !!anyExtras,
          anyId: anyExtras?._id,
          anyActId: anyExtras?.actId,
          anyName: anyExtras?.name || anyExtras?.tscName,
          anyExtrasKeys: anyExtras?.extras ? Object.keys(anyExtras.extras) : [],
          anyDjServices: anyExtras?.djServices,
          anyDj_services: anyExtras?.dj_services,
          anyDjServiceOptions: anyExtras?.djServiceOptions,
        });
      }
    }

    // ✅ GENRES (handles array-of-arrays)
    if (genres?.length) {
      const wantRaw = genres.filter(Boolean);
      const wantAnd = wantRaw.map((g) => g.replace(/&/g, "and"));
      const want = Array.from(new Set([...wantRaw, ...wantAnd]));

      // flatten one level: if genres is ["A","B"] or [["A","B"]], becomes ["A","B"]
      pipeline.push({
        $addFields: {
          _genresFlat: {
            $reduce: {
              input: { $ifNull: ["$genres", []] },
              initialValue: [],
              in: {
                $concatArrays: [
                  "$$value",
                  { $cond: [{ $isArray: "$$this" }, "$$this", ["$$this"]] },
                ],
              },
            },
          },
        },
      });

      // match any of the wanted labels (case-sensitive equality here; aliases cover "&"/"and")
      pipeline.push({
        $match: { _genresFlat: { $in: want } },
      });
    }

    // ✅ Return a richer payload ONLY in debug mode so you can inspect shapes/keys
    pipeline.push({
      $project: debug
        ? {
            _id: 1,
            actId: 1,
            name: 1,
            tscName: 1,
            status: 1,
            isTest: 1,
            genres: 1,
            instruments: 1,
            lineupSizes: 1,
            extras: 1,
            djServices: 1,
            dj_services: 1,
            djServiceOptions: 1,
          }
        : {
            _id: 1,
            actId: 1,
            status: 1,
            isTest: 1,
          },
    });

    // TEMP debug (safe to keep; prints only in non-prod)
    if (process.env.NODE_ENV !== "production") {
      console.log("🔎 /api/v2/act-cards/search pipeline:", JSON.stringify(pipeline, null, 2));
    }

    const cards = await ActFilterCard.aggregate(pipeline);

    if (debug) {
      console.log("✅ [searchActCards] RESULT", {
        count: cards.length,
        first: cards[0] || null,
        firstIds: cards.slice(0, 10).map((c) => String(c.actId || c._id || "")),
      });
    }

    res.json({ ok: true, count: cards.length, cards });
  } catch (err) {
    console.error("searchActCards error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}


