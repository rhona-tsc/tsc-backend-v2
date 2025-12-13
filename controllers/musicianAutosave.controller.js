import musicianAutosaveModel from "../models/musicianAutosaveModel.js";
import PreAutoSavedMusicianFormModel from "../models/PreAutoSavedMusicianForm.model.js";

const MAX_HISTORY = 25;

export const autosaveMusicianForm = async (req, res) => {
  try {
    const { musicianId, formKey = "deputy", snapshot, snapshotHash = "", updatedAtIso = "" } = req.body;

    if (!musicianId || !snapshot) {
      return res.status(400).json({ success: false, message: "musicianId and snapshot are required" });
    }

    // 1) get existing autosave (if any)
    const existing = await musicianAutosaveModel.findOne({ musicianId, formKey }).lean();

    // 2) if exists and differs, archive it BEFORE overwrite
    if (existing?.snapshot) {
      const same = existing.snapshotHash && snapshotHash && existing.snapshotHash === snapshotHash;
      if (!same) {
        await PreAutoSavedMusicianFormModel.create({
          musicianId,
          formKey,
          snapshot: existing.snapshot,
          snapshotHash: existing.snapshotHash || "",
          reason: "pre_autosave_overwrite",
        });

        // 3) keep history capped
        const ids = await PreAutoSavedMusicianFormModel.find({ musicianId, formKey })
          .sort({ createdAt: -1 })
          .skip(MAX_HISTORY)
          .select("_id")
          .lean();

        if (ids.length) {
          await PreAutoSavedMusicianFormModel.deleteMany({ _id: { $in: ids.map((x) => x._id) } });
        }
      }
    }

    // 4) upsert latest autosave
    await musicianAutosaveModel.updateOne(
      { musicianId, formKey },
      { $set: { snapshot, snapshotHash, updatedAtIso } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ autosaveMusicianForm failed:", err);
    return res.status(500).json({ success: false, message: "Autosave failed" });
  }
};

export const listAutosaveHistory = async (req, res) => {
  try {
    const { musicianId } = req.params;
    const { formKey = "deputy", limit = 25 } = req.query;

    const rows = await PreAutoSavedMusicianFormModel.find({ musicianId, formKey })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 25, 100))
      .lean();

    res.json({ success: true, rows });
  } catch (err) {
    console.error("❌ listAutosaveHistory failed:", err);
    res.status(500).json({ success: false });
  }
};