import express from "express";
import actModel from "../models/actModel.js";

const router = express.Router();

router.get("/act-slugs", async (req, res) => {
  // Adjust the filter to match what “live” means in your DB
  const acts = await actModel
    .find({ status: "approved" })
    .select("slug")
    .lean();

  res.json(acts.map((a) => String(a.slug)));
});

export default router;