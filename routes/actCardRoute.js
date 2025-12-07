import express from "express";
import actCardModel from "../models/actCard.model.js";
import actModel from "../models/actModel.js";
import { upsertActCardFromAct } from "../services/actCard.service.js";
import { searchActCards } from "../controllers/actCardController.js";

const router = express.Router();

/**
 * GET /api/act/cards?status=approved,live&sort=-createdAt&limit=200
 */

router.post("/search", searchActCards);

router.get("/cards", async (req, res) => {
  try {
    const { status, limit = 200, sort = "-createdAt", skip = 0 } = req.query;

    const q = {};
    if (status) {
      const arr = String(status).split(",").map(s => s.trim());
      q.status = { $in: arr };
    }

    const sortObj = {};
    String(sort)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(k => {
        if (k.startsWith("-")) sortObj[k.slice(1)] = -1;
        else sortObj[k] = 1;
      });

    const items = await actCardModel
      .find(q)
      .sort(sortObj)
      .skip(Number(skip) || 0)
      .limit(Number(limit) || 200)
      .lean();

    res.json({ items });
  } catch (err) {
    console.error("❌ GET /act/cards failed:", err);
    res.status(500).json({ error: "Failed to fetch act cards" });
  }
});

/**
 * POST /api/act/cards/backfill
 * Optional JSON body: { status: ["approved","live"] }
 */
router.post("/cards/backfill", async (req, res) => {
  try {
    const raw = req.body?.status;
    const statuses = Array.isArray(raw) ? raw : (raw ? String(raw).split(",") : null);

    const q = {};
    if (statuses?.length) q.status = { $in: statuses };

    const acts = await actModel
      .find(q)
      .select("_id name tscName images coverImage profileImage formattedPrice lineups numberOfShortlistsIn timesShortlisted status amendment")
      .lean();

    let updated = 0;
    for (const act of acts) {
      await upsertActCardFromAct(act);
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (err) {
    console.error("❌ POST /act/cards/backfill failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;