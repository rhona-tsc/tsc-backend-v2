import mongoose from "mongoose";

const shareSchema = new mongoose.Schema(
  {
    recipientType: { type: String, enum: ["tsc", "owner", "musician"], required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", default: null },
    role: { type: String, required: true, trim: true },
    percent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const confirmationSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true },
    confirmedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const originalCreditVersionSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    masterShares: { type: [shareSchema], required: true },
    compositionShares: { type: [shareSchema], required: true },
    sourceSubmissionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "originalsubmission" }],
    requiredMusicianIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "musician" }],
    confirmations: { type: [confirmationSchema], default: [] },
    state: { type: String, enum: ["draft", "awaiting_confirmation", "final"], default: "awaiting_confirmation", index: true },
    finalisedAt: { type: Date, default: null },
    finalisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "musician", default: null },
    overrideReason: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

originalCreditVersionSchema.index({ projectId: 1, version: 1 }, { unique: true });

export default mongoose.models.originalcreditversion || mongoose.model("originalcreditversion", originalCreditVersionSchema);
