// controllers/shortlistController.js
import Availability from "../models/availabilityModel.js";

export const getUserShortlist = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) getUserShortlist called`, {
    userId: req.params.userId,
  });

  try {
    const { userId } = req.params;
    // Assuming Availability documents store user's shortlisted acts
    const shortlist = await Availability.find({ userId }).populate("actId");

    const acts = (shortlist || [])
      .map((a) => a.actId)
      .filter(Boolean);

    res.json({ success: true, acts });
  } catch (err) {
    console.error("❌ getUserShortlist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};