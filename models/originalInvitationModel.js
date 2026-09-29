import mongoose from "mongoose";

const originalInvitationSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "originalround", required: true, index: true },
    invitedMusicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true },
    roleName: { type: String, required: true, trim: true },
    message: { type: String, default: "", trim: true, maxlength: 1000 },
    state: { type: String, enum: ["pending", "accepted", "declined", "expired", "cancelled"], default: "pending", index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

originalInvitationSchema.index({ roundId: 1, invitedMusicianId: 1 }, { unique: true });

export default mongoose.models.originalinvitation || mongoose.model("originalinvitation", originalInvitationSchema);
