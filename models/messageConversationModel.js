import mongoose from "mongoose";

const conversationMessageSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true },
    senderRole: {
      type: String,
      enum: ["agent", "musician"],
      required: true,
    },
    senderName: { type: String, default: "" },
    senderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    channel: { type: String, default: "website" },
    readByAdmin: { type: Boolean, default: false },
    readByMusician: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const messageConversationSchema = new mongoose.Schema(
  {
    musicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      required: true,
      unique: true,
      index: true,
    },
    recipientName: { type: String, default: "" },
    recipientEmail: { type: String, default: "", trim: true, lowercase: true },
    recipientPhone: { type: String, default: "" },
    messages: { type: [conversationMessageSchema], default: [] },
  },
  { timestamps: true },
);

export default mongoose.models.MessageConversation ||
  mongoose.model("MessageConversation", messageConversationSchema);
