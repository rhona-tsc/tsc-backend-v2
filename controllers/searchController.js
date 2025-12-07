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
  try {
    const viewerIsAgent = isAgentLike(req.user);

    // base visibility
    const query = {
      status: { $in: APPROVED_LIKE },
    };
    if (!viewerIsAgent) {
      query.isTest = { $ne: true };
    }

    // ---------- optional filters via querystring ----------
    // q: free-text search in name/tscName
    const q = (req.query.q || "").trim();
    if (q) {
      query.$or = [
        { name:   { $regex: q, $options: "i" } },
        { tscName:{ $regex: q, $options: "i" } },
      ];
    }

    // genre/instrument/lineup are multi-value (comma OK)
    const genres = toArray(req.query.genre);
    if (genres.length) query.genres = { $in: genres };

    const instruments = toArray(req.query.instrument);
    if (instruments.length) query.instruments = { $in: instruments };

    const lineups = toArray(req.query.lineup);
    if (lineups.length) query.lineupSizes = { $in: lineups };

    // presence flags: ?has=add_another_vocalist,background_music_playlist
    const hasKeys = toArray(req.query.has);
    if (hasKeys.length) {
      query.$and = (query.$and || []).concat(
        hasKeys.map((k) => ({ [`extras.${k}`]: true }))
      );
    }

    // PLI minimum (number)
    const pliMin = Number(req.query.pliMin);
    if (Number.isFinite(pliMin)) query.pliAmount = { $gte: pliMin };

    // Max dB (i.e., act can perform at or below this)
    const dbMax = Number(req.query.dbMax);
    if (Number.isFinite(dbMax)) query.minDb = { $lte: dbMax };

    // paging
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const page  = Math.max(Number(req.query.page) || 1, 1);
    const skip  = (page - 1) * limit;

    // sorting (default by tscName/name asc)
    const sortParam = String(req.query.sort || "").toLowerCase();
    let sort = { tscName: 1, name: 1 };
    if (sortParam === "newest") sort = { createdAt: -1 };
    if (sortParam === "updated") sort = { updatedAt: -1 };

    const [cards, total] = await Promise.all([
      ActFilterCard.find(query)
        .collation({ locale: "en", strength: 2 })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      ActFilterCard.countDocuments(query),
    ]);

    res.json({
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