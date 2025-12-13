import mongoose from "mongoose";

const PreAutoSavedMusicianFormSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    formKey: { type: String, default: "deputy", index: true },
    snapshot: { type: Object, required: true },
    snapshotHash: { type: String, default: "" },
    reason: { type: String, default: "pre_autosave_overwrite" },
  },
  { timestamps: true }
);

PreAutoSavedMusicianFormSchema.index({ musicianId: 1, formKey: 1, createdAt: -1 });

export default mongoose.model("PreAutoSavedMusicianForm", PreAutoSavedMusicianFormSchema);