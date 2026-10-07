import mongoose from "mongoose";

const deputyInviteSuppressionSchema = new mongoose.Schema(
  {
    emailHash: { type: String, required: true, unique: true, index: true },
    reason: { type: String, default: "recipient_unsubscribed" },
    unsubscribedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.models.DeputyInviteSuppression ||
  mongoose.model("DeputyInviteSuppression", deputyInviteSuppressionSchema);
