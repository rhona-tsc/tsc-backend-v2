import actModel from "../models/actModel";

// ✅ actController.js
export const listActs = async (req, res) => {
  try {
    const acts = await actModel.find({ status: "approved" }); // ← no .select()
    res.json({ success: true, acts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};