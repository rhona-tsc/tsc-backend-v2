// controllers/shortlistController.js
import Shortlist from "../models/shortlistModel.js";

export const getUserShortlist = async (req, res) => {
  console.log(`🐠 (controllers/shortlistController.js) getUserShortlist called`, {
    userId: req.params.userId,
  });

  try {
    const { userId } = req.params;

    // Support both shortlist shapes:
    // 1) one document per shortlist item: { userId, actId }
    // 2) one document containing acts array: { userId, acts: [{ actId }] }
    const shortlist = await Shortlist.find({ userId })
      .populate("actId")
      .populate("acts.actId");

    const acts = (shortlist || [])
      .flatMap((item) => {
        // Shape 1: direct actId on the shortlist document
        if (item?.actId) return [item.actId];

        // Shape 2: nested acts array
        if (Array.isArray(item?.acts)) {
          return item.acts
            .map((entry) => entry?.actId)
            .filter(Boolean);
        }

        return [];
      })
      .filter(Boolean);

    const uniqueActs = acts.filter(
      (act, index, arr) =>
        arr.findIndex((a) => String(a?._id || a) === String(act?._id || act)) === index
    );

    console.log("✅ getUserShortlist returning acts:", {
      count: uniqueActs.length,
      ids: uniqueActs.map((a) => String(a?._id || a)),
    });

    res.json({ success: true, acts: uniqueActs });
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
