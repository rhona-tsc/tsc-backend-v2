import Availability from "../models/availabilityModel.js";



/**
 * Get all shortlisted acts for a user.
 */
export const getUserShortlist = async (req, res) => {
  
  console.log(`🐠 (controllers/shortlistController.js) getUserShortlist called at`, new Date().toISOString(), {
  userId: req.params.userId,
});
  try {
    const { userId } = req.params;
    const shortlist = await Availability.findOne({ userId }).populate("acts");
    if (!shortlist) {
      return res.json({ success: true, acts: [] });
    }
    res.json({ success: true, acts: shortlist.acts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


/// old code end

