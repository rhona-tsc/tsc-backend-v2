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
    "loveCount",
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

    // Keep counters fresh from the acts collection. actcards can be stale if the
    // card was built before loveCount existed or before a shortlist update.
    const actIds = items
      .map((item) => item?.actId)
      .filter(Boolean);

    const sourceActs = actIds.length
      ? await actModel
          .find({ _id: { $in: actIds } })
          .select("_id loveCount timesShortlisted numberOfShortlistsIn")
          .lean()
      : [];

    const countsByActId = new Map(
      sourceActs.map((act) => [
        String(act._id),
        {
          loveCount: Number(act.loveCount ?? act.timesShortlisted ?? act.numberOfShortlistsIn ?? 0) || 0,
          timesShortlisted: Number(act.timesShortlisted ?? 0) || 0,
          numberOfShortlistsIn: Number(act.numberOfShortlistsIn ?? 0) || 0,
        },
      ])
    );

    const hydratedItems = items.map((item) => {
      const counts = countsByActId.get(String(item?.actId || ""));
      if (!counts) {
        return {
          ...item,
          loveCount: Number(item?.loveCount ?? item?.timesShortlisted ?? item?.numberOfShortlistsIn ?? 0) || 0,
          timesShortlisted: Number(item?.timesShortlisted ?? 0) || 0,
          numberOfShortlistsIn: Number(item?.numberOfShortlistsIn ?? 0) || 0,
        };
      }

      return {
        ...item,
        loveCount: counts.loveCount,
        timesShortlisted: counts.timesShortlisted,
        numberOfShortlistsIn: counts.numberOfShortlistsIn,
      };
    });

    console.log("🔥 /api/act/cards source", {
      model: actCardModel?.collection?.name,
      count: hydratedItems.length,
      first: hydratedItems[0]
        ? {
            actId: hydratedItems[0].actId,
            tscName: hydratedItems[0].tscName,
            imageUrl: hydratedItems[0].imageUrl,
            basePrice: hydratedItems[0].basePrice,
            minDisplayPrice: hydratedItems[0].minDisplayPrice,
            loveCount: hydratedItems[0].loveCount,
            status: hydratedItems[0].status,
          }
        : null,
    });

    res.json({ success: true, acts: hydratedItems, items: hydratedItems });
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
          "loveCount",
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