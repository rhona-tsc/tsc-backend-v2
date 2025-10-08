// models/OutboundQueue.js
import mongoose from "mongoose";

/**
 * We persist a `dedupeKey` so Mongo can enforce uniqueness.
 * Format: `${phone}|${kind}|${actId}|${dateISO}|${addressShort}`
 */
const OutboundQueueSchema = new mongoose.Schema({
  phone: { type: String, index: true, required: true },
  kind: {
    type: String,
    enum: ["availability", "booking_request", "__lock__"],
    required: true,
  },
  // minimal info to rebuild/send the message
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true, // actId, lineupId, dateISO, address, variables, smsBody, etc.
  },
  // used for strong dedupe across concurrent enqueues
  dedupeKey: { type: String, required: true, index: true, unique: true },

  insertedAt: { type: Date, default: Date.now, index: true },
});

OutboundQueueSchema.index({ phone: 1, insertedAt: 1 });

export default mongoose.model("OutboundQueue", OutboundQueueSchema);