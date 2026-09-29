import mongoose from "mongoose";

const originalEventSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "originalproject",
      required: true,
      index: true,
    },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "originalround", default: null, index: true },
    type: { type: String, required: true, trim: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", default: null },
    actorRole: { type: String, default: "", trim: true },
    fromState: { type: String, default: "", trim: true },
    toState: { type: String, default: "", trim: true },
    reason: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

originalEventSchema.index({ projectId: 1, createdAt: 1 });

const originalEventModel =
  mongoose.models.originalevent ||
  mongoose.model("originalevent", originalEventSchema);

export default originalEventModel;
