import mongoose from "mongoose";

const takeSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 80 },
    stemAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", required: true },
    stemAssetIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "originalasset" }], default: undefined, validate: { validator: value => !value || (value.length >= 1 && value.length <= 4 && new Set(value.map(String)).size === value.length), message: "Supply one to four distinct stems" } },
    wetStemAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", default: null },
    effects: { type: String, enum: ['with_effects', 'without_effects', 'not_specified'], default: 'not_specified' },
    mixdownAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", default: null, required: function () { return this.ownerDocument().listeningMixRequired !== false; } },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  { _id: true },
);

const selectedRangeSchema = new mongoose.Schema(
  {
    takeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    startSeconds: { type: Number, required: true, min: 0 },
    endSeconds: { type: Number, required: true, min: 0 },
    note: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: true },
);

const originalSubmissionSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "originalround", required: true, index: true },
    reservationId: { type: mongoose.Schema.Types.ObjectId, ref: "originalreservation", required: true, unique: true },
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    roleName: { type: String, required: true, trim: true },
    category: { type: String, enum: ["contribution", "mix", "master"], default: "contribution", index: true },
    outputAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", default: null },
    songwritingChoice: { type: String, enum: ["master_only", "songwriting_claim"], required: true },
    anonymous: { type: Boolean, default: false },
    creditName: { type: String, default: "", trim: true },
    listeningMixRequired: { type: Boolean, default: true },
    takes: {
      type: [takeSchema],
      validate: [function validateTakes(value) {
        return this.outputAssetId ? value.length === 0 : value.length >= 1 && value.length <= 4;
      }, "Submit one to four takes, or one production output"],
    },
    notes: { type: String, default: "", trim: true, maxlength: 2000 },
    state: { type: String, enum: ["submitted", "accepted", "rejected", "withdrawn", "retraction_requested", "retracted"], default: "submitted", index: true },
    revision: { type: Number, default: 1, min: 1 },
    revisionSession: {
      id: String,
      status: { type: String, enum: ['editing', 'completed', 'expired'] },
      openedAt: Date, expiresAt: Date,
      openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'musician' },
      source: { type: String, enum: ['contributor', 'owner_request', 'approved_request'] },
      feedback: { type: String, maxlength: 2000 },
    },
    revisionRequest: {
      id: String,
      status: { type: String, enum: ['pending', 'approved', 'declined', 'cancelled'] },
      requestedAt: Date, responseDueAt: Date, escalatedAt: Date,
      reason: { type: String, maxlength: 2000 },
      feedback: { type: String, maxlength: 2000 },
      decidedAt: Date, decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'musician' },
    },
    previousVersions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    ownerNotificationPending: { type: Boolean, default: false, index: true },
    submitterConfirmationPending: { type: Boolean, default: false, index: true },
    submittedChatPending: { type: Boolean, default: false },
    approvedChatPending: { type: Boolean, default: false },
    selectionMode: { type: String, enum: ["whole_take", "selected_ranges", ""], default: "" },
    selectedTakeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    selectedRanges: { type: [selectedRangeSchema], default: [] },
    decisionNote: { type: String, default: "", trim: true, maxlength: 2000 },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "musician", default: null },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.models.originalsubmission || mongoose.model("originalsubmission", originalSubmissionSchema);
