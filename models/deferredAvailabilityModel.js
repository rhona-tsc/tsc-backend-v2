// models/deferredAvailabilityModel.js
import mongoose from "mongoose";

const DeferredAvailabilitySchema = new mongoose.Schema(
  {
    reason: { type: String, default: "no-reply-3h", index: true },

    actId: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
    lineupId: { type: mongoose.Schema.Types.ObjectId, index: true },
    availabilityId: { type: mongoose.Schema.Types.ObjectId, index: true }, // AvailabilityModel _id
    dateISO: { type: String, index: true, required: true },
    phone: { type: String, index: true, required: true },
    slotIndex: { type: Number, default: 0, index: true },

    // nice-to-have for notify later if the Availability row can’t be found
    formattedAddress: { type: String, default: "TBC" },
    clientName: { type: String, default: "" },
    clientEmail: { type: String, default: "" },

    dueAt: { type: Date, index: true, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "processed", "cancelled", "error"],
      default: "pending",
      index: true,
    },

    processingStartedAt: { type: Date },
    processedAt: { type: Date },
    error: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// not unique → we handle idempotency in code
DeferredAvailabilitySchema.index({
  actId: 1, dateISO: 1, slotIndex: 1, phone: 1, reason: 1, status: 1
});

export default mongoose.models.DeferredAvailability
  || mongoose.model("DeferredAvailability", DeferredAvailabilitySchema);