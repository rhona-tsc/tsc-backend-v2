import mongoose from "mongoose";

const takeSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 80 },
    stemAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", required: true },
    mixdownAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", required: true },
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
    takes: {
      type: [takeSchema],
      validate: [function validateTakes(value) {
        return this.outputAssetId ? value.length === 0 : value.length >= 1 && value.length <= 3;
      }, "Submit one to three takes, or one production output"],
    },
    notes: { type: String, default: "", trim: true, maxlength: 2000 },
    state: { type: String, enum: ["submitted", "accepted", "rejected", "withdrawn"], default: "submitted", index: true },
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
