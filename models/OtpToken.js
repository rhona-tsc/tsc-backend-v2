import mongoose from "mongoose";

const OtpTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// TTL index: document auto-deletes after expiresAt
// NOTE: TTL cleanup is not instant; Mongo runs it roughly every minute.
OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("OtpToken", OtpTokenSchema);