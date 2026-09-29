import mongoose from "mongoose";

const originalNotificationSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    recipientMusicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    eventKey: { type: String, required: true, trim: true },
    channels: { type: [String], enum: ["email", "whatsapp"], default: ["email", "whatsapp"] },
    template: { type: String, required: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    state: { type: String, enum: ["queued", "sent", "failed", "cancelled"], default: "queued", index: true },
    sendAfter: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

originalNotificationSchema.index({ recipientMusicianId: 1, eventKey: 1 }, { unique: true });

export default mongoose.models.originalnotification || mongoose.model("originalnotification", originalNotificationSchema);
