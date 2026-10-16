import mongoose from "mongoose";

const ClientAutomationDeliverySchema = new mongoose.Schema(
  {
    automationKey: { type: String, required: true, trim: true },
    automationNumber: { type: Number, required: true },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingBoardItem",
      required: true,
    },
    bookingRef: { type: String, default: "", trim: true },
    recipient: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, default: "" },
    scheduledForISO: { type: String, default: "" },
    status: {
      type: String,
      enum: ["sending", "sent", "failed"],
      default: "sending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    attemptedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    messageId: { type: String, default: "" },
    invoiceAttached: { type: Boolean, default: false },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

ClientAutomationDeliverySchema.index(
  { automationKey: 1, bookingId: 1 },
  { unique: true },
);

export default mongoose.model(
  "ClientAutomationDelivery",
  ClientAutomationDeliverySchema,
);
