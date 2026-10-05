import mongoose from "mongoose";

const originalAssetSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "originalround", default: null, index: true },
    reservationId: { type: mongoose.Schema.Types.ObjectId, ref: "originalreservation", default: null },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    kind: {
      type: String,
      enum: ["initial_stem", "guide_track", "demo", "voice_note", "video_submission", "click_track", "take_stem", "take_mixdown", "mix", "master"],
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
    state: { type: String, enum: ["active", "hidden", "deleted"], default: "active", index: true },
  },
  { timestamps: true },
);

export default mongoose.models.originalasset || mongoose.model("originalasset", originalAssetSchema);
