import express from "express";
import Feedback from "../models/feedbackModel.js";

const router = express.Router();

// Create feedback
router.post("/create", async (req, res) => {
  try {
    const { userId, name, email, message } = req.body;

    const fb = await Feedback.create({ userId, name, email, message });

    res.json({ success: true, feedback: fb });
  } catch (err) {
    console.error("❌ Feedback create error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get all feedback (agent only)
router.get("/all", async (req, res) => {
  try {
    const msgs = await Feedback.find().sort({ createdAt: -1 });
    res.json({ success: true, feedback: msgs });
  } catch {
    res.status(500).json({ success: false });
  }
});

// Mark as read
router.put("/mark-read/:id", async (req, res) => {
  try {
    const fb = await Feedback.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );
    res.json({ success: true, feedback: fb });
  } catch {
    res.status(500).json({ success: false });
  }
});

// Badge count
router.get("/unread-count", async (req, res) => {
  try {
    const count = await Feedback.countDocuments({ read: false });
    res.json({ success: true, count });
  } catch {
    res.status(500).json({ success: false });
  }
});

export default router;