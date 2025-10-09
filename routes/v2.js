// backend/routes/v2.js
import express from "express";
import { getAvailableActIds } from "../controllers/actAvailabilityController.js";
import { getTravelData } from "../controllers/travelController.js";

const router = express.Router();

/**
 * GET /api/v2/availability/acts-by-dateV2?date=YYYY-MM-DD
 * Reuses your existing controller; no legacy aliasing.
 */
router.get("/availability/acts-by-dateV2", async (req, res) => {
  try {
    const date = String(req.query?.date || "").slice(0, 10);
    if (!date) return res.status(400).json({ success: false, message: "date required" });
    req.query.date = date;           // controller expects ?date
    return await getAvailableActIds(req, res);
  } catch (err) {
    console.error("v2 acts-by-date error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * Optional single-act check:
 * GET /api/v2/availability/check?actId=...&date=YYYY-MM-DD
 */
router.get("/availability/check", async (req, res) => {
  try {
    const actId = String(req.query?.actId || "");
    const date  = String(req.query?.date || "").slice(0, 10);
    if (!actId || !date) return res.status(400).json({ success:false, message:"actId and date required" });

    req.query.date = date;
    const payload = await new Promise((resolve) => {
      const shadowRes = {
        status: (c) => ({ json: (j) => resolve({ code: c, json: j }) }),
        json: (j) => resolve({ code: 200, json: j }),
      };
      getAvailableActIds(req, shadowRes).catch((e) =>
        resolve({ code: 500, json: { success: false, message: e?.message || String(e) } })
      );
    });

    const list = payload?.json?.availableActIds || [];
    return res.json({ success:true, actId, date, isAvailable: list.includes(actId), raw: payload?.json });
  } catch (err) {
    console.error("v2 availability/check error:", err?.message || err);
    return res.status(500).json({ success:false, message:"Server error" });
  }
});

/**
 * GET /api/v2/travel/travel-data?origin=...&destination=...&date=YYYY-MM-DD
 * Delegates directly to the travel controller to avoid any internal fetches,
 * so it works the same locally, on Render, and on Netlify.
 */
router.get("/travel/travel-data", async (req, res) => {
  try {
    // Controller already validates params and returns normalized shape:
    // { success, date, outbound, returnTrip, sources }
    return await getTravelData(req, res);
  } catch (err) {
    console.error("v2 travel-data error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;