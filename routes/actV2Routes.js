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
  getMyDrafts,
  getModerationCount,
  trashAct,
  getTrashedActs,
  restoreAct,
  deleteActPermanently,
  updateActStatus,
} from "../controllers/actV2Controller.js";

import { getActCards } from "../controllers/actCardController.js";
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

router.post("/trash", wrap("POST /trash", trashAct));
router.get("/trashed", wrap("GET /trashed", getTrashedActs));
router.delete("/delete-permanent", wrap("DELETE /delete-permanent", deleteActPermanently));
router.post("/restore", wrap("POST /restore", restoreAct));
router.get("/list", wrap("GET /list", getAllActsV2));
router.get("/cards", wrap("GET /cards", getActCards));

router.get("/:id([0-9a-fA-F]{24})", wrap("GET /:id", getActByIdV2));

router.post("/security-update/:id", wrap("POST /security-update/:id", updateActV2));
router.get("/my-drafts", wrap("GET /my-drafts", getMyDrafts));
router.put("/save-pending-changes/:id", wrap("PUT /save-pending-changes/:id", savePendingChanges));
router.put("/approve-pending-changes/:id", wrap("PUT /approve-pending-changes/:id", approvePendingChanges));
router.put("/reject-pending-changes/:id", wrap("PUT /reject-pending-changes/:id", rejectPendingChanges));
router.get("/moderation-count", wrap("GET /moderation-count", getModerationCount));
router.post("/update-status", wrap("POST /update-status", updateActStatus));

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

router.get(
  "/acts/:id",
  (req, res, next) => {
    console.log("📡 Route hit: GET /api/v2/acts/:id", req.params.id);
    next();
  },
  wrap("GET /acts/:id", getActByIdV2)
);

export default router;