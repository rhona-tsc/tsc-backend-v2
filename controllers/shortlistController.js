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

