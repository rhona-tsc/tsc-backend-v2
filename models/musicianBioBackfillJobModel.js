import mongoose from "mongoose";

const musicianBioBackfillJobSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    cursor: { type: mongoose.Schema.Types.ObjectId, default: null },
    processed: { type: Number, default: 0 },
    generated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    totalEligible: { type: Number, default: 0 },
    currentMusicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", default: null },
    currentMusicianName: { type: String, default: "" },
    lastReason: { type: String, default: "" },
    error: { type: String, default: "" },
    recentErrors: [
      {
        musicianId: { type: mongoose.Schema.Types.ObjectId, default: null },
        musicianName: { type: String, default: "" },
        message: { type: String, default: "" },
        occurredAt: { type: Date, default: Date.now },
      },
    ],
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export default mongoose.models.MusicianBioBackfillJob ||
  mongoose.model("MusicianBioBackfillJob", musicianBioBackfillJobSchema);
