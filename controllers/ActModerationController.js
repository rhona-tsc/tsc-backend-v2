// controllers/actModerationController.js
import actModel from "../models/actModel.js";
import { upsertActCardFromAct } from "./helpers/upsertActCardFromAct.js";

// 1. Save pending changes to a live act
export const savePendingChanges = async (req, res) => {
  try {
    const actId = req.params.id;
    const changes = req.body;

    const act = await actModel.findById(actId);
    if (!act) return res.status(404).json({ error: "Act not found" });

    if (act.status === "live") {
      act.pendingChanges = changes;
      act.status = "Approved, changes pending";
      await act.save();

      // 🔄 Card upsert (optional depending on how cards reflect pending)
      try { await upsertActCardFromAct(act); } catch (e) {
        console.warn("⚠️ Card upsert after saving pending changes failed:", e.message);
      }

      return res.status(200).json({ message: "Changes saved for review", status: act.status });
    }

    // Draft/pending → apply directly
    const updatedAct = await actModel.findByIdAndUpdate(actId, changes, {
      new: true,
      runValidators: true,
    });

    // 🔄 Card upsert
    try { await upsertActCardFromAct(updatedAct); } catch (e) {
      console.warn("⚠️ Card upsert after direct changes failed:", e.message);
    }

    res.status(200).json({ message: "Changes saved directly", status: updatedAct.status });
  } catch (err) {
    console.error("❌ Error saving pending changes:", err);
    res.status(500).json({ error: "Failed to save pending changes" });
  }
};

// 2. Approve pending changes and apply them to the live act
export const approvePendingChanges = async (req, res) => {
  try {
    const act = await actModel.findById(req.params.id);
    if (!act || !act.pendingChanges) {
      return res.status(404).json({ error: "No pending changes found" });
    }

    Object.assign(act, act.pendingChanges);
    act.pendingChanges = null;
    act.status = "live";
    await act.save();

    // 🔄 Card upsert
    try { await upsertActCardFromAct(act); } catch (e) {
      console.warn("⚠️ Card upsert after approving changes failed:", e.message);
    }

    res.status(200).json({ message: "Changes approved and applied" });
  } catch (err) {
    console.error("❌ Error approving changes:", err);
    res.status(500).json({ error: "Failed to approve changes" });
  }
};

// 3. Reject and discard the pending changes
export const rejectPendingChanges = async (req, res) => {
  try {
    const act = await actModel.findById(req.params.id);
    if (!act || !act.pendingChanges) return res.status(404).json({ error: "No pending changes found" });

    act.pendingChanges = null;
    act.status = "live";
    await act.save();

    res.status(200).json({ message: "Changes rejected and discarded" });
  } catch (err) {
    console.error("❌ Error rejecting changes:", err);
    res.status(500).json({ error: "Failed to reject changes" });
  }
};
