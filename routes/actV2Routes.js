// backend/routes/acts.v2.js (noisy logging)
import express from "express";
import util from "util";
import actModel from "../models/actModel.js";
import {
  approvePendingChanges,
  rejectPendingChanges,
  savePendingChanges,
} from "../controllers/ActModerationController.js";

import {
  saveActDraftV2,
  createActV2,
  getActByIdV2,
  updateActV2,
  getAllActsV2,
  getActBySlugV2,
  getMyDrafts,
  getModerationCount,
  trashAct,
  getTrashedActs,
  restoreAct,
  deleteActPermanently,
  updateActStatus,
} from "../controllers/actV2Controller.js";
import actCardModel from "../models/actCard.model.js";
import { upsertActCardFromAct } from "../services/actCard.service.js";
import { searchActCards } from "../controllers/actCardController.js";
import requireAnyAuth from "../middleware/requireAnyAuth.js";

/* ------------------------------- LOG HELPERS ------------------------------ */
const inspect = (obj, depth = 6) =>
  util.inspect(obj, { depth, colors: false, maxArrayLength: 200 });

const makeRid = () => Math.random().toString(36).slice(2, 8);

const wrap = (label, fn) => async (req, res, next) => {
  const rid = (req._rid ||= makeRid());
  const t0 = Date.now();
  console.log(`▶️  [acts.v2][${rid}] ${label} start`);
  try {
    const out = await fn(req, res, next);
    console.log(`⏹️  [acts.v2][${rid}] ${label} end • ${Date.now() - t0}ms`);
    return out;
  } catch (err) {
    console.error(
      `❌ [acts.v2][${rid}] ${label} error:`,
      err?.stack || err?.message || err
    );
    return next(err);
  }
};

// Global request banner for everything under this router
const router = express.Router();
router.use((req, res, next) => {
  req._rid = req._rid || makeRid();
  req._t0 = Date.now();
  console.log(`\n🧭 [acts.v2][${req._rid}] ${req.method} ${req.originalUrl}`);
  if (Object.keys(req.query || {}).length)
    console.log("   ↳ query:", inspect(req.query));
  if (req.method !== "GET" && Object.keys(req.body || {}).length)
    console.log("   ↳ body :", inspect(req.body));

  res.on("finish", () => {
    const ms = Date.now() - (req._t0 || Date.now());
    console.log(`✅ [acts.v2][${req._rid}] ${res.statusCode} • ${ms}ms\n`);
  });
  next();
});

/* ----------------------- Lightweight enrich endpoint ---------------------- */
const filterDataInline = async (req, res) => {
  const rid = req._rid || "rid";
  const t0 = Date.now();
  try {
    // ids intake
    const rawIds = (() => {
      if (Array.isArray(req.body?.ids)) return req.body.ids;
      if (typeof req.body?.ids === "string") return req.body.ids.split(",");
      if (typeof req.query?.ids === "string") return req.query.ids.split(",");
      return [];
    })()
      .map((s) => String(s).trim())
      .filter(Boolean);

    const ids = Array.from(
      new Set(rawIds.filter((id) => /^(?=.{24}$)[0-9a-fA-F]+$/.test(id)))
    );
    const statusArr =
      typeof req.query?.status === "string"
        ? req.query.status.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    console.log(
      `🧪 [acts.v2][${rid}] filter-data IN: rawIds=${rawIds.length} validIds=${ids.length} status=${inspect(
        statusArr
      )}`
    );
    if (ids.length === 0) {
      console.log(`ℹ️  [acts.v2][${rid}] filter-data: no valid ids → []`);
      return res.json([]);
    }

    const statusFilter = statusArr.length ? { status: { $in: statusArr } } : {};
    console.log(
      `🔎 [acts.v2][${rid}] filter-data Mongo filter:`,
      inspect({ _id: { $in: ids }, ...statusFilter })
    );

    const acts = await actModel
      .find({ _id: { $in: ids }, ...statusFilter })
      .select(
        [
          "name",
          "tscName",
          "slug",
          "status",
          "isTest",
          "genre",
          "genres",
          "lineups",
          "images",
          "profileImage",
          "coverImage",
          "extras",
          "pli",
          "paSystem",
          "lightingSystem",
          "useMUTravelRates",
          "useCountyTravelFee",
          "countyFees",
          "costPerMile",
          "reviews",
        ].join(" ")
      )
      .lean();

    console.log(
      `📦 [acts.v2][${rid}] filter-data fetched ${acts.length} / ${ids.length}`
    );
    // which ids missed?
    const foundIds = new Set(acts.map((a) => String(a?._id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) console.log(`⚠️  missing ids:`, missing.join(", "));

    const sizeOf = (l) => {
      const m = String(l?.act_size || l?.actSize || "").match(/(\d+)/);
      if (m) return parseInt(m[1], 10);
      return Array.isArray(l?.bandMembers) ? l.bandMembers.length : 0;
    };

    const items = acts.map((a) => {
      const lineups = Array.isArray(a?.lineups) ? a.lineups : [];
      const lineupSizes = lineups
        .map(sizeOf)
        .filter((n) => Number.isFinite(n) && n > 0);

      const instruments = Array.from(
        new Set(
          lineups
            .flatMap((l) => (Array.isArray(l?.bandMembers) ? l.bandMembers : []))
            .map((m) => (m?.instrument || "").trim())
            .filter(Boolean)
        )
      );

      const genres = Array.isArray(a?.genres)
        ? a.genres.filter(Boolean)
        : Array.isArray(a?.genre)
        ? a.genre.filter(Boolean)
        : [];

      const hasImages = Boolean(
        (Array.isArray(a?.coverImage) && a.coverImage.length) ||
          (Array.isArray(a?.images) && a.images.length) ||
          (Array.isArray(a?.profileImage) && a.profileImage.length)
      );

      // Reviews summary (avoid shipping full reviews array in card payload)
      const verifiedReviews = Array.isArray(a?.reviews)
        ? a.reviews.filter((r) => (r?.verified ?? true) && Number.isFinite(r?.rating))
        : [];

      const reviewCount = verifiedReviews.length;
      const averageRating = reviewCount
        ? Math.round(
            (verifiedReviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviewCount) * 10
          ) / 10
        : 0;

      const extras = (() => {
        const raw = a?.extras;
        if (!raw) return [];
        if (raw instanceof Map) return Array.from(raw.keys());
        if (typeof raw === "object" && !Array.isArray(raw)) return Object.keys(raw);
        return [];
      })();

      const hasCountyFees =
        !!a?.countyFees &&
        ((a.countyFees instanceof Map && a.countyFees.size > 0) ||
          (typeof a.countyFees === "object" &&
            !Array.isArray(a.countyFees) &&
            Object.keys(a.countyFees).length > 0));

      const travelMode = a?.useMUTravelRates
        ? "mu_rates"
        : a?.useCountyTravelFee && hasCountyFees
        ? "county"
        : typeof a?.costPerMile === "number" && a.costPerMile > 0
        ? "per_mile"
        : "none";

      return {
        id: String(a?._id || ""),
        slug: a?.slug || "",
        name: a?.name || a?.tscName || "",
        status: a?.status || "",
        isTest: !!a?.isTest,
        genres,
        instruments,
        lineupsCount: lineups.length,
        lineupSizes,
        hasImages,
        hasPA: !!a?.paSystem,
        hasLighting: !!a?.lightingSystem,
        hasPLI: !!a?.pli,
        pliAmount: a?.pli?.amount || a?.pli?.value || "",
        extrasKeys: extras,
        travelMode,
        reviewCount,
        averageRating,
      };
    });

    // Preview log
    console.log(
      `🧾 [acts.v2][${rid}] filter-data OUT: ${items.length} items • ${Date.now() - t0}ms`
    );
    console.table(
      items.slice(0, 10).map((x) => ({
        id: x.id,
        name: x.name?.slice(0, 24),
        status: x.status,
        genres: (x.genres || []).join("|").slice(0, 40),
        instr: (x.instruments || []).slice(0, 5).join("|"),
        sizes: (x.lineupSizes || []).join(","),
        extrasN: (x.extrasKeys || []).length,
        reviews: x.reviewCount,
        rating: x.averageRating,
        travel: x.travelMode,
      }))
    );

    return res.json(items);
  } catch (err) {
    console.error("v2 filter-data error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* --------------------------------- Routes -------------------------------- */
router.post("/save-draft", wrap("POST /save-draft", saveActDraftV2));
router.post("/create", requireAnyAuth, wrap("POST /create", createActV2));
router.put("/update/:id", requireAnyAuth, wrap("PUT /update/:id", updateActV2));

router.post("/trash", requireAnyAuth, wrap("POST /trash", trashAct));
router.get("/trashed", requireAnyAuth, wrap("GET /trashed", getTrashedActs));
router.delete(
  "/delete-permanent",
  requireAnyAuth,
  wrap("DELETE /delete-permanent", deleteActPermanently)
);
router.post("/restore", requireAnyAuth, wrap("POST /restore", restoreAct));

router.post(
  "/security-update/:id",
  requireAnyAuth,
  wrap("POST /security-update/:id", updateActV2)
);
router.get("/my-drafts", requireAnyAuth, wrap("GET /my-drafts", getMyDrafts));
router.put(
  "/save-pending-changes/:id",
  requireAnyAuth,
  wrap("PUT /save-pending-changes/:id", savePendingChanges)
);
router.put(
  "/approve-pending-changes/:id",
  requireAnyAuth,
  wrap("PUT /approve-pending-changes/:id", approvePendingChanges)
);
router.put(
  "/reject-pending-changes/:id",
  requireAnyAuth,
  wrap("PUT /reject-pending-changes/:id", rejectPendingChanges)
);
router.get(
  "/moderation-count",
  requireAnyAuth,
  wrap("GET /moderation-count", getModerationCount)
);
router.post("/update-status", requireAnyAuth, wrap("POST /update-status", updateActStatus));

router.get("/filter-data", wrap("GET /filter-data", filterDataInline));

// --- Compatibility aliases for /api/v2/acts ---
router.get(
  "/acts",
  (req, res, next) => {
    console.log("🚀 Route hit: GET /api/v2/acts", inspect(req.query));
    next();
  },
  wrap("GET /acts", getAllActsV2)
);




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

// --- Legacy list endpoint used by admin UI (e.g. /api/act/list?q=Soul...)
router.get("/list", wrap("GET /list", getAllActsV2));

// Keep id route
router.get("/:id([0-9a-fA-F]{24})", requireAnyAuth, wrap("GET /:id", getActByIdV2));

// Guard slug so it doesn't swallow /list, /cards, etc
const RESERVED_SLUGS = new Set([
  "list",
  "cards",
  "search",
  "filter-data",
  "acts",
  "v2",
  "save-draft",
  "create",
  "update",
  "trash",
  "trashed",
  "restore",
  "delete-permanent",
  "moderation-count",
  "my-drafts",
  "update-status",
  "security-update",
  "cards",
  "cards/backfill",
]);

router.get("/:slug", (req, res, next) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (RESERVED_SLUGS.has(slug)) return next();
  return wrap("GET /:slug", getActBySlugV2)(req, res, next);
});


export default router;