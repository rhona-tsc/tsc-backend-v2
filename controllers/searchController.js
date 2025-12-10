import ActFilterCard from "../models/ActFilterCard.js";


const APPROVED_LIKE = [
  "approved",
  "live",
  "approved_changes_pending",
  "live_changes_pending",
];

function isAgentLike(user = {}) {
  const role = String(user.userRole || "").toLowerCase();
  const id   = String(user.id || user._id || "");
  const email = String(user.email || "");
  return (
    ["agent", "admin", "moderator"].includes(role) ||
    id === "680fb453a2de6618675ca9ed" ||
    /@thesupremecollective\.co\.uk$/i.test(email)
  );
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const getFilterCards = async (req, res) => {
  // helper: normalise "&" → "and", collapse spaces, lowercase
  const normGenre = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\s*&\s*/g, " and ")
      .replace(/\s+/g, " ")
      .trim();

  try {
    const viewerIsAgent = isAgentLike(req.user);

    // ---------- base visibility ----------
    const baseMatch = {
      status: { $in: APPROVED_LIKE },
    };
    if (!viewerIsAgent) {
      baseMatch.isTest = { $ne: true };
    }

    // ---------- optional filters via querystring ----------
    // q: free-text search in name/tscName
    const q = (req.query.q || "").trim();
    if (q) {
      baseMatch.$or = [
        { name: { $regex: q, $options: "i" } },
        { tscName: { $regex: q, $options: "i" } },
      ];
    }

    // genre/instrument/lineup are multi-value (comma OK)
    const genresRaw = toArray(req.query.genre);
    const instruments = toArray(req.query.instrument);
    const lineups = toArray(req.query.lineup);

    if (instruments.length) baseMatch.instruments = { $in: instruments };
    if (lineups.length) baseMatch.lineupSizes = { $in: lineups };

    // presence flags: ?has=add_another_vocalist,background_music_playlist
    const hasKeys = toArray(req.query.has);
    if (hasKeys.length) {
      baseMatch.$and = (baseMatch.$and || []).concat(
        hasKeys.map((k) => ({ [`extras.${k}`]: true }))
      );
    }

    // PLI minimum (number)
    const pliMin = Number(req.query.pliMin);
    if (Number.isFinite(pliMin)) baseMatch.pliAmount = { $gte: pliMin };

    // Max dB (i.e., act can perform at or below this)
    const dbMax = Number(req.query.dbMax);
    if (Number.isFinite(dbMax)) baseMatch.minDb = { $lte: dbMax };

    // paging
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    // sorting (default by tscName/name asc)
    const sortParam = String(req.query.sort || "").toLowerCase();
    let sortStage = { tscName: 1, name: 1 };
    if (sortParam === "newest") sortStage = { createdAt: -1 };
    if (sortParam === "updated") sortStage = { updatedAt: -1 };

    // ---------- Decide if we need aggregation ----------
    // We need a pipeline when genres are supplied because cards may store genres
    // as nested arrays or only as normalised fields.
    const wantGenres = genresRaw.filter(Boolean);
    const wantGenresNorm = wantGenres.map(normGenre);
    const needAgg = wantGenres.length > 0;

    if (!needAgg) {
      // Simple path — use find/count directly
      if (process.env.NODE_ENV !== "production") {
        console.log("🔎 [/api/v2/search/cards] query (simple):", JSON.stringify(baseMatch));
      }

      const [cards, total] = await Promise.all([
        ActFilterCard.find(baseMatch)
          .collation({ locale: "en", strength: 2 })
          .sort(sortStage)
          .skip(skip)
          .limit(limit)
          .lean(),
        ActFilterCard.countDocuments(baseMatch),
      ]);

      return res.json({
        page,
        limit,
        total,
        results: cards,
      });
    }

    // ---------- Aggregation path (genres present) ----------
    // We flatten one level of genres (to handle [["Soul & Motown","Israeli",...]])
    // and normalise them server-side. We then match by either raw labels or
    // normalised labels. We still include baseMatch for all other filters.
    const pipeline = [
      { $match: baseMatch },

      // Flatten genres one level → _genresFlat: ["A","B",...]
      {
        $addFields: {
          _genresFlat: {
            $reduce: {
              input: { $ifNull: ["$genres", []] },
              initialValue: [],
              in: {
                $concatArrays: [
                  "$$value",
                  {
                    $cond: [
                      { $isArray: "$$this" },
                      "$$this",
                      ["$$this"],
                    ],
                  },
                ],
              },
            },
          },
        },
      },

      // Normalise flattened genres → _genresNorm
      {
        $addFields: {
          _genresNorm: {
            $map: {
              input: { $ifNull: ["$_genresFlat", []] },
              as: "g",
              in: {
                $trim: {
                  input: {
                    $replaceAll: {
                      input: {
                        $replaceAll: {
                          input: { $toLower: "$$g" },
                          find: "&",
                          replace: " and ",
                        },
                      },
                      find: "  ",
                      replace: " ",
                    },
                  },
                },
              },
            },
          },
        },
      },

      // Match by raw (string equality) OR by normalised labels OR existing normalised fields
      {
        $match: {
          $or: [
            { _genresFlat: { $in: wantGenres } },
            { _genresNorm: { $in: wantGenresNorm } },
            { genresNormalized: { $in: wantGenresNorm } }, // if present on docs
            { genres_norm: { $in: wantGenresNorm } },      // alias if present
          ],
        },
      },

      // Sorting + paging
      { $sort: sortStage },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
          ],
          total: [{ $count: "n" }],
        },
      },
    ];

    if (process.env.NODE_ENV !== "production") {
      console.log(
        "🔎 [/api/v2/search/cards] pipeline (genres):",
        JSON.stringify(pipeline, null, 2)
      );
      console.log("🔎 genres wantRaw:", wantGenres, "wantNorm:", wantGenresNorm);
    }

    const facet = await ActFilterCard.aggregate(pipeline).collation({ locale: "en", strength: 2 });
    const cards = Array.isArray(facet?.[0]?.data) ? facet[0].data : [];
    const total = Number(facet?.[0]?.total?.[0]?.n || 0);

    return res.json({
      page,
      limit,
      total,
      results: cards,
    });
  } catch (err) {
    console.error("GET /api/v2/search/cards error:", err);
    res.status(500).json({ error: "Failed to fetch cards" });
  }
};