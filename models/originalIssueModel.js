import mongoose from "mongoose";

const issueMessageSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true },
    type: { type: String, enum: ["reason", "response", "amendment_request", "resolution_note"], required: true },
    body: { type: String, required: true, trim: true, maxlength: 3000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const originalIssueSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    submissionId: { type: mongoose.Schema.Types.ObjectId, ref: "originalsubmission", required: true, index: true },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true },
    category: { type: String, enum: ["lyrics", "creative_direction", "credit", "conduct", "other"], required: true },
    priorSubmissionState: { type: String, enum: ["submitted", "accepted"], required: true },
    state: { type: String, enum: ["open", "remedy_proposed", "further_amendments", "resolved", "retraction_confirmed", "cancelled"], default: "open", index: true },
    messages: { type: [issueMessageSchema], default: [] },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.models.originalissue || mongoose.model("originalissue", originalIssueSchema);
