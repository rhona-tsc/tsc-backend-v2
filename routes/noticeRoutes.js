import express from "express";
import Notice from "../models/noticeModel.js";

const router = express.Router();

// Create notice
router.post("/create", async (req, res) => {
  try {
    const { title, body, authorId, authorName, pinned } = req.body;

    const notice = await Notice.create({
      title,
      body,
      authorId,
      authorName,
      pinned: !!pinned,
    });

    res.json({ success: true, notice });
  } catch (err) {
    console.error("❌ Notice create error:", err);
    res.status(500).json({ success: false });
  }
});

// Get all notices (latest first, pinned at top)
router.get("/all", async (req, res) => {
  try {
    const notices = await Notice.find({ archived: false })
      .sort({ pinned: -1, createdAt: -1 });

    res.json({ success: true, notices });
  } catch {
    res.status(500).json({ success: false });
  }
});

// Update notice
router.put("/update/:id", async (req, res) => {
  try {
    const updated = await Notice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json({ success: true, notice: updated });
  } catch {
    res.status(500).json({ success: false });
  }
});

// Archive notice
router.put("/archive/:id", async (req, res) => {
  try {
    const updated = await Notice.findByIdAndUpdate(
      req.params.id,
      { archived: true },
      { new: true }
    );
    res.json({ success: true, notice: updated });
  } catch {
    res.status(500).json({ success: false });
  }
});

// Badge count (new announcements since last view)
router.get("/new-count", async (req, res) => {
  try {
    const count = await Notice.countDocuments({
      archived: false,
      createdAt: { $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) } // last 7 days
    });

    res.json({ success: true, count });
  } catch {
    res.status(500).json({ success: false });
  }
});

export default router;