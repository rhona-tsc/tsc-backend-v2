// controllers/actCardController.js
import ActCard from "../models/actCard.model.js";

export async function listActCards(req, res) {
  try {
    const {
      status = "approved",
      q = "",
      limit = "50",
      page = "1",
      sort = "-createdAt",
      includeTrashed = "false",
    } = req.query;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pg  = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pg - 1) * lim;

    const filter = {};
    if (includeTrashed !== "true") filter.status = { $ne: "trashed" };
    if (status) {
      const toks = String(status).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      if (toks.length) filter.status = { $in: toks };
    }
    if (q.trim()) {
      filter.$or = [
        { tscName: new RegExp(q.trim(), "i") },
        { name: new RegExp(q.trim(), "i") },
      ];
    }

    const [total, acts] = await Promise.all([
      ActCard.countDocuments(filter),
      ActCard.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(lim)
        .lean()
        .select({
          actId: 1,
          tscName: 1,
          name: 1,
          slug: 1,
          imageUrl: 1,
          basePrice: 1,
          loveCount: 1,
          status: 1,
        }),
    ]);

    res.json({
      success: true,
      total,
      page: pg,
      pageSize: acts.length,
      acts,
    });
  } catch (err) {
    console.error("❌ listActCards error", err);
    res.status(500).json({ success: false, message: "Failed to fetch cards" });
  }
}