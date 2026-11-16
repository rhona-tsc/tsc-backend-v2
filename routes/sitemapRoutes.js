import express from "express";
import actModel from "../models/actModel.js";
import { publicActStatuses } from "../utils/publicActStatuses.js";

const router = express.Router();

router.get("/act-slugs", async (req, res) => {
  // Approved acts remain public while amendments await review.
  const acts = await actModel
    .find({ status: { $in: publicActStatuses } })
    .select("slug")
    .lean();

  res.json(acts.map((a) => String(a.slug)));
});

export default router;
