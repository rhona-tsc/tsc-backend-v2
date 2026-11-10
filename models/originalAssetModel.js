import mongoose from "mongoose";

const originalAssetSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "originalround", default: null, index: true },
    reservationId: { type: mongoose.Schema.Types.ObjectId, ref: "originalreservation", default: null },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    kind: {
      type: String,
      enum: ["initial_stem", "temporary_stem", "guide_track", "demo", "voice_note", "video_submission", "click_track", "take_stem", "take_mixdown", "mix", "master", "chat_attachment"],
      required: true,
    },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    bytes: { type: Number, required: true, min: 1 },
    cloudinaryPublicId: { type: String, required: true, unique: true },
    cloudinaryResourceType: { type: String, enum: ["video", "raw"], required: true },
    cloudinaryFormat: { type: String, default: "", trim: true },
    deliveryType: { type: String, default: "authenticated" },
    finalEligible: { type: Boolean, default: true },
    replacementRoleName: { type: String, trim: true, maxlength: 80, default: '', required: function () { return this.kind === 'temporary_stem'; } },
    // Uploader declaration only; null means it was not recorded for this file.
    createdEntirelyWithAi: { type: Boolean, default: null },
    alignmentReviewRequired: { type: Boolean, default: false },
    alignmentReview: {
      contextKey: { type: String, default: '' },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', default: null },
    },
    state: { type: String, enum: ["active", "hidden", "deleted"], default: "active", index: true },
  },
  { timestamps: true },
);

export default mongoose.models.originalasset || mongoose.model("originalasset", originalAssetSchema);
