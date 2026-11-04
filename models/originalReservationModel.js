import mongoose from "mongoose";

const extensionRequestSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["pending", "approved", "declined"], default: undefined },
    requestedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    hours: { type: Number, enum: [12, 24], default: undefined },
  },
  { _id: false },
);

const originalReservationSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "originalproject", required: true, index: true },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "originalround", required: true, index: true },
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician", required: true, index: true },
    seatNumber: { type: Number, min: 1, max: 3 },
    slotHeld: { type: Boolean, default: true },
    futureReservationId: { type: mongoose.Schema.Types.ObjectId, ref: "originalrolereservation" },
    roundNotificationQueued: { type: Boolean, default: false },
    roleName: { type: String, required: true, trim: true },
    agreementAcceptanceId: { type: mongoose.Schema.Types.ObjectId, ref: "originalagreementacceptance" },
    anonymous: { type: Boolean, default: false },
    creditName: { type: String, default: "", trim: true },
    state: { type: String, enum: ["active", "submitted", "expired", "released", "cancelled"], default: "active", index: true },
    reservedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    extensionCount: { type: Number, default: 0, min: 0, max: 3 },
    extensionRequest: { type: extensionRequestSchema, default: undefined },
    remindersSent: {
      twelveHour: { type: Boolean, default: false },
      sixHour: { type: Boolean, default: false },
      oneHour: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

originalReservationSchema.index(
  { roundId: 1, musicianId: 1 },
  { unique: true, partialFilterExpression: { state: "active" } },
);

originalReservationSchema.index({ roundId: 1, seatNumber: 1 }, { unique: true, partialFilterExpression: { slotHeld: true, seatNumber: { $type: "number" } } });
originalReservationSchema.index({ futureReservationId: 1 }, { unique: true, sparse: true });
export default mongoose.models.originalreservation || mongoose.model("originalreservation", originalReservationSchema);
