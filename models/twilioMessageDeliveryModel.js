import mongoose from "mongoose";

const twilioMessageDeliverySchema = new mongoose.Schema(
  {
    messageSid: { type: String, required: true, unique: true, index: true },
    to: { type: String, required: true, index: true },
    channel: {
      type: String,
      enum: ["whatsapp", "sms"],
      required: true,
      index: true,
    },
    body: { type: String, default: "" },
    source: { type: String, default: "" },
    status: { type: String, default: "queued", index: true },
    errorCode: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
    smsFallbackStatus: {
      type: String,
      enum: ["not_required", "pending", "sending", "sent", "failed"],
      default: "not_required",
      index: true,
    },
    smsFallbackSid: { type: String, default: "" },
    smsFallbackSentAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

export default mongoose.models.TwilioMessageDelivery ||
  mongoose.model("TwilioMessageDelivery", twilioMessageDeliverySchema);
