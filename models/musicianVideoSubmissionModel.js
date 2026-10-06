import mongoose from "mongoose";

const flagSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" },
    label: { type: String, default: "" },
    evidence: { type: String, default: "" },
    severity: { type: String, enum: ["info", "warning", "high"], default: "warning" },
  },
  { _id: false },
);

const musicianVideoSubmissionSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    category: { type: String, enum: ["function", "original"], default: "function", index: true },
    suppliedTitle: { type: String, default: "" },
    originalName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    cloudinaryPublicId: { type: String, required: true },
    cloudinaryFormat: { type: String, default: "" },
    cloudinaryResourceType: { type: String, default: "video" },
    status: {
      type: String,
      enum: ["processing", "manual_required", "ready_for_review", "publishing", "published", "rejected", "failed"],
      default: "processing",
      index: true,
    },
    moderationReason: { type: String, default: "" },
    moderationFlags: { type: [flagSchema], default: [] },
    azureVideoId: { type: String, default: "" },
    azureState: { type: String, default: "" },
    azureProcessedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    youtubeVideoId: { type: String, default: "" },
    youtubeUrl: { type: String, default: "" },
    youtubeTitle: { type: String, default: "" },
    publishedAt: { type: Date, default: null },
    error: { type: String, default: "" },
    musicianNotifiedAt: { type: Date, default: null },
    musicianNotificationType: { type: String, default: "" },
  },
  { timestamps: true },
);

musicianVideoSubmissionSchema.index({ musicianId: 1, createdAt: -1 });

export default mongoose.model("MusicianVideoSubmission", musicianVideoSubmissionSchema);
