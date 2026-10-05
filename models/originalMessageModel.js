import mongoose from "mongoose";

const originalMessageSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    body: { type: String, default: "", trim: true, maxlength: 3000 },
    voiceAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "originalasset", default: null },
    authorAnonymous: { type: Boolean, default: false },
    authorCreditName: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

originalMessageSchema.index({ projectId: 1, createdAt: 1 });
export default mongoose.models.originalmessage || mongoose.model("originalmessage", originalMessageSchema);
