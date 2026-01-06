import express from "express";
import actModel from "../models/actModel.js";

const router = express.Router();

router.get("/act-ids", async (req, res) => {
  // Adjust the filter to match what “live” means in your DB
  const acts = await actModel
    .find({ status: "live" })
    .select("_id")
    .lean();

  res.json(acts.map((a) => String(a._id)));
});

export default router;