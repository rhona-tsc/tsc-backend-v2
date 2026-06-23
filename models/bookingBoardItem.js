import mongoose from "mongoose";

const EmailSchema = new mongoose.Schema(
  {
    label: { type: String }, // e.g. "Bride", "Planner"
    email: { type: String, required: true },
  },
  { _id: false },
);

const AllocationSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["not_started", "in_progress", "fully_allocated", "gap"],
      default: "not_started",
    },
    lastCheckedAt: { type: Date },
    notes: { type: String },
    // optional: who/role gaps you still need
    gaps: [{ instrument: String, needed: Number }],
  },
  { _id: false },
);

const ReviewSchema = new mongoose.Schema(
  {
    requestedCount: { type: Number, default: 0 },
    lastRequestedAt: { type: Date },
    received: { type: Boolean, default: false },
    link: { type: String }, // internal review URL or Trustpilot/Google
    source: {
      type: String,
      enum: ["internal", "google", "trustpilot", "other"],
      default: "internal",
    },
  },
  { _id: false },
);

const PaymentsSchema = new mongoose.Schema(
  {
    balanceInvoiceUrl: { type: String }, // Stripe hosted invoice link
    balancePaymentReceived: { type: Boolean, default: false },
    depositAmount: { type: Number }, // £ deposit expected (from Stripe/cart)
    depositChargedAmount: { type: Number }, // £ actually charged on Stripe
    bandPaymentsSent: { type: Boolean, default: false },
    boardInvoicePdfUrl: { type: String, default: "" },
    boardInvoiceCreatedAt: { type: Date },
    bandPayments: [
      {
        musicianId: mongoose.Types.ObjectId,
        amount: Number,
        sentAt: Date,
        method: {
          type: String,
          enum: ["bacs", "manual", "stripe_connect", "other"],
        },
      },
    ],
  },
  { _id: false },
);

const BookingExtraSchema = new mongoose.Schema(
  {
    id: { type: String },
    key: { type: String, default: "" },
    name: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
    arrivalTime: { type: String, default: "" },
    finishTime: { type: String, default: "" },
    category: { type: String, default: "" },
    pricingMode: { type: String, default: "flat" },
    appliedMinutes: { type: Number, default: 0 },
    billableMemberCount: { type: Number, default: 0 },
    payoutMemberIds: [{ type: mongoose.Schema.Types.ObjectId }],
    payoutMemberNames: [{ type: String }],
    paLateStay: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const ManualAdjustmentSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    amount: { type: Number, default: 0 },
  },
  { _id: false },
);

const BookingDetailsSchema = new mongoose.Schema(
  {
    eventType: { type: String }, // Wedding, Corporate, etc.
    ceremony: { start: String, end: String, notes: String },
    afternoon: { start: String, end: String, notes: String },
    evening: {
      arrivalTime: String,
      finishTime: String,
      sets: [{ start: String, end: String, length: String }], // e.g. 2x60
      notes: String,
    },
    djServicesBooked: { type: Boolean, default: false },
    extras: [BookingExtraSchema],
    manualAdjustment: ManualAdjustmentSchema,
  },
  { _id: false },
);

const AccountingSchema = new mongoose.Schema(
  {
    invoiceCompany: {
      type: String,
      enum: ["TSC", "BMM"],
      default: "TSC",
    },
    paymentStage: { type: String, default: "" },
    vatRate: { type: Number, default: 0.2 },
    commissionGross: { type: Number, default: 0 },
    commissionVat: { type: Number, default: 0 },
    commissionNet: { type: Number, default: 0 },
    passThroughGross: { type: Number, default: 0 },
    currency: { type: String, default: "GBP" },
  },
  { _id: false },
);

const BookingBoardItemSchema = new mongoose.Schema(
  {
    // link to core booking if exists
    bookingId: { type: mongoose.Types.ObjectId, ref: "Booking" },

    // visible columns
    bookerName: { type: String },
    clientFirstNames: { type: String },
    bookingRef: { type: String, index: true, unique: false },
    eventSheetLink: { type: String },
    contractUrl: { type: String }, // link to generated contract PDF/HTML
    eventDateISO: { type: String, index: true }, // "2025-09-20"
    enquiryDateISO: { type: String }, // "yyyy-mm-dd" — first contact
    bookingDateISO: { type: String }, // "yyyy-mm-dd" — when confirmed/paid
    invoiceDateISO: { type: String }, // when invoice was generated

    invoiceDueDateISO: { type: String }, // payment due date
    grossValue: { type: Number, default: 0 },
    netCommission: { type: Number, default: 0 }, // agency commission amount £
    agent: { type: String }, // e.g. "Encore", "TSC Direct", "Other Agent"
    clientEmails: [EmailSchema],
    clientEmail: { type: String },
    clientAddress: { type: String, default: "" },
    eventType: { type: String },
    actName: { type: String },
    actTscName: { type: String },
    address: { type: String },
    county: { type: String },
    payments: PaymentsSchema,
    invoiceUrl: { type: String, default: "" },
    invoicePdfUrl: { type: String, default: "" },
    bandSize: { type: Number, default: 0 }, // excluding manager
    lineupSelected: { type: String }, // human label e.g. "6-Piece (2xVoc, Sax, Gtr, Bass, Drums)"
    lineupComposition: [{ type: String }], // e.g. ["Lead Vocal","Guitar","Bass","Drums"]
    arrivalTime: { type: String }, // “17:30”
    finishTime: { type: String }, // “23:30”
    sourceBookingId: { type: mongoose.Types.ObjectId, ref: "Booking" },
    source: { type: String, default: "" },
    sessionId: { type: String },
    accounting: AccountingSchema,
    bookingDetails: BookingDetailsSchema,
    extras: [BookingExtraSchema],
    manualAdjustment: ManualAdjustmentSchema,
    manualAdjustmentLabel: { type: String, default: "" },
    manualAdjustmentAmount: { type: Number, default: 0 },
    allocation: AllocationSchema,
    review: ReviewSchema,

    // access control helpers
    actOwnerMusicianId: { type: mongoose.Types.ObjectId }, // so act owners see only their rows
    visibility: {
      grossAndCommissionVisibleToAdminOnly: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

export default mongoose.model("BookingBoardItem", BookingBoardItemSchema);
