import mongoose from "mongoose";

const MusicianAutosaveSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    formKey: { type: String, default: "deputy", index: true }, // in case you later autosave other forms
    snapshot: { type: Object, required: true },
    snapshotHash: { type: String, default: "" }, // optional de-dupe
    updatedAtIso: { type: String, default: "" },
  },
  { timestamps: true }
);

MusicianAutosaveSchema.index({ musicianId: 1, formKey: 1 }, { unique: true });

export default mongoose.model("MusicianAutosave", MusicianAutosaveSchema);