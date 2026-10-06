import mongoose from "mongoose";

const legacyVideoMigrationSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    sourceField: { type: String, required: true },
    title: { type: String, default: "" },
    url: { type: String, required: true },
    normalizedUrl: { type: String, required: true },
    provider: { type: String, default: "unknown", index: true },
    wasApproved: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ["discovered", "checking", "tsc_owned", "replacement_required", "broken", "migrated", "exempt"],
      default: "discovered",
      index: true,
    },
    youtubeVideoId: { type: String, default: "" },
    youtubeChannelId: { type: String, default: "" },
    embeddable: { type: Boolean, default: null },
    privacyStatus: { type: String, default: "" },
    reason: { type: String, default: "" },
    invitationSentAt: { type: Date, default: null },
    reminderCount: { type: Number, default: 0 },
    lastReminderAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

legacyVideoMigrationSchema.index({ musicianId: 1, normalizedUrl: 1 }, { unique: true });

export default mongoose.model("LegacyVideoMigration", legacyVideoMigrationSchema);
