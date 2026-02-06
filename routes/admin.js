import express from "express";
import { rebuildAndApplyAvailabilityBadge } from "../controllers/availabilityController.js";

const adminRoutes = express.Router();

adminRoutes.post("/admin/rebuild-badge", async (req, res) => {
  try {
    const { actId, dateISO } = req.body;
    const result = await rebuildAndApplyAvailabilityBadge({ actId, dateISO });
    res.json(result);
  } catch (err) {
    console.error("❌ /admin/rebuild-badge failed", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

export default adminRoutes;