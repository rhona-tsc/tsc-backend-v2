import express from "express";
import { rebuildAndApplyAvailabilityBadge } from "./availabilityController";

const router = express.Router();

router.post("/admin/rebuild-badge", async (req, res) => {
  const { actId, dateISO } = req.body;
  const result = await rebuildAndApplyAvailabilityBadge({ actId, dateISO });
  res.json(result);
});
export default router;