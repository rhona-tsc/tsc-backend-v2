// ✅ routes/shortlist.js
import express from "express";
import Act from "../models/actModel.js";
import User from "../models/userModel.js";
import {
  getUserShortlist,
} from "../controllers/shortlistController.js";
import { triggerAvailabilityRequest } from "../controllers/availabilityController.js";



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
}, triggerAvailabilityRequest);

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
/* 🟡 POST /add — Add or toggle shortlist + trigger availability              */
/* -------------------------------------------------------------------------- */
router.post("/add", (req, res, next) => {
  console.log(
    `🟡 (routes/shortlist.js) /add START at ${new Date().toISOString()}`,
    { body: req.body }
  );
  next();
}, triggerAvailabilityRequest);

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
/* 🟠 PATCH /update — If date/location added later, trigger availability       */
/* -------------------------------------------------------------------------- */
// controllers/shortlistController.js
import Shortlist from "../models/shortlistModel.js";

export const getUserShortlist = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) getUserShortlist called`, {
    userId: req.params.userId,
  });

  try {
    const { userId } = req.params;
    // Query the Shortlist collection for user's shortlisted acts
    const shortlist = await Shortlist.find({ userId }).populate("acts.actId", null, "act");

    const acts = (shortlist || [])
      .map((a) => a.actId)
      .filter(Boolean);

    res.json({ success: true, acts });
  } catch (err) {
    console.error("❌ getUserShortlist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateShortlistItem = async (req, res) => {
  try {
    const { actId, userId, dateISO, selectedAddress } = req.body;
    console.log("📦 [updateShortlistItem] Payload:", req.body);

    if (!actId || !userId)
      return res.status(400).json({ success: false, message: "Missing actId or userId" });

    const updateData = {};
    if (dateISO) updateData.dateISO = dateISO;
    if (selectedAddress) updateData.selectedAddress = selectedAddress;

    const result = await Shortlist.findOneAndUpdate(
      { actId, userId },
      { $set: updateData },
      { new: true }
    );

    if (!result)
      return res.status(404).json({ success: false, message: "Shortlist item not found" });

    console.log("✅ [updateShortlistItem] Updated:", result._id);
    res.json({ success: true, updated: true, shortlist: result });
  } catch (err) {
    console.error("❌ [updateShortlistItem] Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

export default router;