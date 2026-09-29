import mongoose from "mongoose";

const originalRoundSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "originalproject",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["foundation", "instrument", "mix", "master"],
      required: true,
    },
    sequence: { type: Number, required: true, min: 0 },
    roleName: { type: String, default: "", trim: true },
    eligibleRoles: { type: [String], default: [] },
    state: {
      type: String,
      enum: ["scheduled", "open", "review", "closed", "reopened", "cancelled"],
      default: "scheduled",
      index: true,
    },
    slotLimit: { type: Number, default: 3, min: 1, max: 3 },
    openedAt: { type: Date, default: null },
    closesAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

originalRoundSchema.index({ projectId: 1, sequence: 1 }, { unique: true });
originalRoundSchema.index({ state: 1, closesAt: 1 });

const originalRoundModel =
  mongoose.models.originalround ||
  mongoose.model("originalround", originalRoundSchema);

export default originalRoundModel;
