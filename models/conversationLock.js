// models/ConversationLock.js
import mongoose from "mongoose";

const ConversationLockSchema = new mongoose.Schema({
  phone: { type: String, index: true, required: true },   // +44...
  enquiryId: { type: String, required: true },            // the active item
  messageSidOut: { type: String },                        // WA (or SMS) sid
  createdAt: { type: Date, default: Date.now },
  // auto-release after X hours if no reply (self-healing)
  expiresAt: { type: Date, index: { expires: '6h' } },    // TTL index
  meta: { type: mongoose.Schema.Types.Mixed },
});

// enforce single active lock per phone
ConversationLockSchema.index(
  { phone: 1 },
  { unique: true, name: "uniq_phone_active_lock" }
);

export default mongoose.model("ConversationLock", ConversationLockSchema);