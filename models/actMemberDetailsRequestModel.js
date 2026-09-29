import mongoose from "mongoose";

const actMemberDetailsRequestSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    actId: { type: mongoose.Schema.Types.ObjectId, ref: "act", required: true, index: true },
    lineupId: { type: mongoose.Schema.Types.ObjectId, required: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, required: true },
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    roleName: { type: String, required: true, trim: true },
    state: { type: String, enum: ["queued", "completed", "expired", "cancelled"], default: "queued", index: true },
    expiresAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
    emailDeliveryState: { type: String, enum: ["not_sent", "queued", "sent", "failed"], default: "not_sent" },
  },
  { timestamps: true },
);

export default mongoose.models.actmemberdetailsrequest || mongoose.model("actmemberdetailsrequest", actMemberDetailsRequestSchema);
