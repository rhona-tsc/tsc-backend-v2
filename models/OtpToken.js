// models/OtpToken.js
import mongoose from "mongoose";

const OtpTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

export default mongoose.model("OtpToken", OtpTokenSchema);