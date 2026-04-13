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
      .select(
        [
          "actId",
          "name",
          "tscName",
          "slug",
          "imageUrl",
          "images",
          "basePrice",
          "minDisplayPrice",
          "availabilityBadge",
          "status",
          "genres",
          "instruments",
          "leadRole",
          "vocalist",
          "timesShortlisted",
          "numberOfShortlistsIn",
          "createdAt",
          "updatedAt",
          "bestseller",
          "bestSeller",
          "isTest",
        ].join(" ")
      )
      .sort(sortObj)
      .skip(Number(skip) || 0)
      .limit(Number(limit) || 200)
      .lean();

    console.log("🔥 /api/act/cards source", {
      model: actCardModel?.collection?.name,
      count: items.length,
      first: items[0]
        ? {
            actId: items[0].actId,
            tscName: items[0].tscName,
            imageUrl: items[0].imageUrl,
            basePrice: items[0].basePrice,
            minDisplayPrice: items[0].minDisplayPrice,
            status: items[0].status,
          }
        : null,
    });

    res.json({ success: true, acts: items, items });
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
      .select(
        [
          "_id",
          "name",
          "tscName",
          "slug",
          "images",
          "coverImage",
          "profileImage",
          "formattedPrice",
          "minDisplayPrice",
          "lineups",
          "numberOfShortlistsIn",
          "timesShortlisted",
          "status",
          "bestseller",
          "bestSeller",
          "updatedAt",
          "createdAt",
          "isTest",
          "genres",
          "genre",
          "instruments",
          "instrumentation",
          "leadRole",
          "vocalist",
        ].join(" ")
      )
      .lean();

    let updated = 0;
    for (const act of acts) {
      await upsertActCardFromAct(act);
      updated++;
    }

    console.log("✅ /api/act/cards/backfill complete", {
      sourceModel: actModel?.collection?.name,
      targetModel: actCardModel?.collection?.name,
      updated,
      statuses: statuses?.length ? statuses : ["all"],
    });

    res.json({ ok: true, updated });
  } catch (err) {
    console.error("❌ POST /act/cards/backfill failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;