// ✅ routes/shortlist.js
import express from "express";
import Act from "../models/actModel.js";
import User from "../models/userModel.js";
import {
  shortlistActAndTriggerAvailability,
  getUserShortlist,
  notifyMusician,
} from "../controllers/shortlistController.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 🟡 POST /add — Add or toggle shortlist + trigger availability              */
/* -------------------------------------------------------------------------- */
router.post("/add", (req, res, next) => {
  console.log(
    `🟡 (routes/shortlist.js) /add START at ${new Date().toISOString()}`,
    { body: req.body }
  );
  next();
}, shortlistActAndTriggerAvailability);

/* -------------------------------------------------------------------------- */
/* 🟢 GET /user/:userId/shortlisted                                           */
/* -------------------------------------------------------------------------- */
router.get("/user/:userId/shortlisted", (req, res, next) => {
  console.log(
    `🟢 (routes/shortlist.js) /user/:userId/shortlisted START at ${new Date().toISOString()}`,
    { userId: req.params.userId }
  );
  next();
}, getUserShortlist);

/* -------------------------------------------------------------------------- */
/* 🟣 PATCH /act/:id/increment-shortlist                                      */
/* -------------------------------------------------------------------------- */
router.patch("/act/:id/increment-shortlist", async (req, res) => {
  console.log(
    `🟣 (routes/shortlist.js) /act/:id/increment-shortlist START at ${new Date().toISOString()}`
  );

  const { userId, updateTimesShortlisted } = req.body;
  const actId = req.params.id;

  try {
    const actUpdates = {
      $inc: {
        numberOfShortlistsIn: 1,
        ...(updateTimesShortlisted && { timesShortlisted: 1 }),
      },
    };
    await Act.findByIdAndUpdate(actId, actUpdates, { new: true });

    if (userId) {
      await User.findByIdAndUpdate(
        userId,
        { $addToSet: { shortlistedActs: actId } },
        { new: true }
      );
    }

    return res.json({ success: true, message: "Shortlist incremented" });
  } catch (err) {
    console.error("❌ (shortlist.js) increment-shortlist failed:", err);
    return res
      .status(500)
      .json({ error: "Failed to increment shortlist counters." });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔵 PATCH /act/:id/decrement-shortlist                                      */
/* -------------------------------------------------------------------------- */
router.patch("/act/:id/decrement-shortlist", async (req, res) => {
  console.log(
    `🔵 (routes/shortlist.js) /act/:id/decrement-shortlist START at ${new Date().toISOString()}`
  );

  const { userId } = req.body;
  const actId = req.params.id;

  try {
    await Act.findByIdAndUpdate(
      actId,
      { $inc: { numberOfShortlistsIn: -1 } },
      { new: true }
    );

    if (userId) {
      await User.findByIdAndUpdate(
        userId,
        { $pull: { shortlistedActs: actId } },
        { new: true }
      );
    }

    return res.json({ success: true, message: "Shortlist decremented" });
  } catch (err) {
    console.error("❌ (shortlist.js) decrement-shortlist failed:", err);
    return res
      .status(500)
      .json({ error: "Failed to decrement shortlist counters." });
  }
});

/* -------------------------------------------------------------------------- */
/* 🟤 POST /notify-musician                                                   */
/* -------------------------------------------------------------------------- */
router.post("/notify-musician", (req, res, next) => {
  console.log(
    `🟤 (routes/shortlist.js) /notify-musician START at ${new Date().toISOString()}`,
    { body: req.body }
  );
  next();
}, notifyMusician);

export default router;