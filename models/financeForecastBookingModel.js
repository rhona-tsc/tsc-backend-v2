import mongoose from "mongoose";

const FinanceForecastBookingSchema = new mongoose.Schema(
  {
    boardRowId: { type: mongoose.Types.ObjectId, ref: "BookingBoardItem", index: true },
    sourceBookingId: { type: mongoose.Types.ObjectId, ref: "Booking", index: true },

    bookingRef: { type: String, index: true },
    clientName: String,
    clientEmail: String,

    eventDateISO: { type: String, index: true },
    eventMonth: { type: String, index: true }, // yyyy-mm

    agent: String,
    actName: String,
    actTscName: String,

    grossValue: { type: Number, default: 0 },

    commissionGross: { type: Number, default: 0 },
    commissionVat: { type: Number, default: 0 },
    commissionNet: { type: Number, default: 0 },
    passThroughGross: { type: Number, default: 0 },

    depositPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },

    expectedCashDateISO: String,
    expectedBalanceDueDateISO: String,

    status: {
      type: String,
      enum: ["forecast", "deposit_paid", "balance_due", "paid", "cancelled"],
      default: "forecast",
      index: true,
    },

    source: {
      type: String,
      default: "booking_board",
    },

    rawSnapshot: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

FinanceForecastBookingSchema.index(
  { bookingRef: 1, boardRowId: 1 },
  { unique: true, sparse: true },
);

export default mongoose.model(
  "FinanceForecastBooking",
  FinanceForecastBookingSchema,
);