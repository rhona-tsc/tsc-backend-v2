import mongoose from "mongoose";

const ClientAutomationDigestSchema = new mongoose.Schema(
  {
    digestDate: { type: String, required: true, unique: true },
    recipient: { type: String, required: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["sending", "sent", "failed"],
      default: "sending",
      index: true,
    },
    bookingCount: { type: Number, default: 0 },
    warningCount: { type: Number, default: 0 },
    messageId: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model(
  "ClientAutomationDigest",
  ClientAutomationDigestSchema,
);
