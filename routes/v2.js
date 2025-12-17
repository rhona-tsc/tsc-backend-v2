// backend/routes/v2.js
import express from "express";
import util from "util";
import { getAvailableActIds } from "../controllers/actAvailabilityController.js";
import { getTravelData } from "../controllers/travelController.js";
import { getFilterCards } from "../controllers/searchController.js";
import { optionalAuthUser } from "../middleware/auth.js";
import { searchActCards } from "../controllers/actCardController.js";

const router = express.Router();



// small middleware to print auth context after optionalAuthUser
const afterAuth = (label) => (req, _res, next) => {
  const authSummary = {
    userId: req.user?._id || req.user?.id || req.headers.userid || null,
    role: req.user?.role || req.headers.userrole || null,
    scope: req.headers["x-scope"] || null,
  };
  console.log(`👤 [v2][${req._rid}] ${label} auth:`, inspect(authSummary));
  next();
};

// wrapper to time & log controller entry/exit
const wrap = (label, fn) => async (req, res, next) => {

  
  try {
    const out = await fn(req, res, next);
  
    return out;
  } catch (err) {
    console.error(
      `❌ [v2][${req._rid}] ${label} error:`,
      err?.stack || err?.message || err
    );
    return next(err);
  }
};

/* ───────────────────────────── Routes ───────────────────────────── */

// Search cards (GET)
router.get(
  "/search/cards",
  optionalAuthUser,
  afterAuth("GET /search/cards"),
  wrap("GET /search/cards", getFilterCards)
);

// Alias: GET /act-cards/search
router.get(
  "/act-cards/search",
  optionalAuthUser,
  afterAuth("GET /act-cards/search"),
  wrap("GET /act-cards/search", getFilterCards)
);

// POST /act-cards/search
router.post(
  "/act-cards/search",
  optionalAuthUser,
  afterAuth("POST /act-cards/search"),
  wrap("POST /act-cards/search", searchActCards)
);

/**
 * GET /api/v2/availability/acts-by-dateV2?date=YYYY-MM-DD
 */
router.get(
  "/availability/acts-by-dateV2",
  wrap("GET /availability/acts-by-dateV2", async (req, res) => {
    try {
      const raw = String(req.query?.date || "");
      const date = raw.slice(0, 10);
      console.log(`🗓️  [v2][${req._rid}] acts-by-dateV2 date=`, date, "(raw:", raw, ")");
      if (!date)
        return res
          .status(400)
          .json({ success: false, message: "date required" });

      req.query.date = date; // controller expects ?date
      return await getAvailableActIds(req, res);
    } catch (err) {
      console.error(
        "v2 acts-by-dateV2 error:",
        err?.stack || err?.message || err
      );
      return res
        .status(500)
        .json({ success: false, message: "Server error" });
    }
  })
);

/**
 * GET /api/v2/availability/check?actId=...&date=YYYY-MM-DD
 */
router.get(
  "/availability/check",
  wrap("GET /availability/check", async (req, res) => {
    try {
      const actId = String(req.query?.actId || "");
      const rawDate = String(req.query?.date || "");
      const date = rawDate.slice(0, 10);
      console.log(
        `🔎 [v2][${req._rid}] availability/check actId=${actId} date=${date} (raw:${rawDate})`
      );
      if (!actId || !date)
        return res
          .status(400)
          .json({ success: false, message: "actId and date required" });

      // Call controller in shadow to inspect payload
      req.query.date = date;
      const payload = await new Promise((resolve) => {
        const shadowRes = {
          status: (c) => ({
            json: (j) => resolve({ code: c, json: j }),
          }),
          json: (j) => resolve({ code: 200, json: j }),
        };
        getAvailableActIds(req, shadowRes).catch((e) =>
          resolve({
            code: 500,
            json: { success: false, message: e?.message || String(e) },
          })
        );
      });

      const list = payload?.json?.availableActIds || [];
      console.log(
        `📋 [v2][${req._rid}] availability/check payload: code=${payload?.code} count=${list.length}`
      );

      return res.json({
        success: true,
        actId,
        date,
        isAvailable: list.includes(actId),
        raw: payload?.json,
      });
    } catch (err) {
      console.error(
        "v2 availability/check error:",
        err?.stack || err?.message || err
      );
      return res
        .status(500)
        .json({ success: false, message: "Server error" });
    }
  })
);

/**
 * GET /api/v2/travel/travel-data?origin=...&destination=...&date=YYYY-MM-DD
 */
router.get(
  "/travel/travel-data",
  wrap("GET /travel/travel-data", async (req, res) => {
    try {
      const { origin, destination, date } = req.query || {};
  
      // Delegates; controller validates and returns normalized shape
      return await getTravelData(req, res);
    } catch (err) {
      console.error(
        "v2 travel-data error:",
        err?.stack || err?.message || err
      );
      return res
        .status(500)
        .json({ success: false, message: "Server error" });
    }
  })
);

export default router;