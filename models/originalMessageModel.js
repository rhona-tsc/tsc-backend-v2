import mongoose from "mongoose";

const originalMessageSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    body: { type: String, default: "", trim: true, maxlength: 3000 },
    messageType: { type: String, enum: ['message', 'stem_submitted', 'stem_approved'], default: 'message' },
    voiceAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", default: null },
    attachmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "originalasset" }],
    chatNotificationsQueued: { type: Boolean, default: false },
    clientMessageId: { type: String, maxlength: 100 },
    authorAnonymous: { type: Boolean, default: false },
    authorCreditName: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

originalMessageSchema.index({ projectId: 1, createdAt: 1 });
originalMessageSchema.index({ projectId: 1, authorId: 1, clientMessageId: 1 }, { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } });
export default mongoose.models.originalmessage || mongoose.model("originalmessage", originalMessageSchema);
