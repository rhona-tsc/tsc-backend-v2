// models/bookingModel.js
import mongoose from "mongoose";

/* -------------------------------------------------------------------------- */
/*                                   Extras                                   */
/* -------------------------------------------------------------------------- */

const ExtraPayoutAllocationSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    name: String,
    role: String,
    amount: { type: Number, default: 0 }, // net £ owed to this musician for this extra
    minutes: { type: Number, default: 0 },
    isLateStayMember: { type: Boolean, default: false },
    isPaLateStayMember: { type: Boolean, default: false },
    isPaHireMember: { type: Boolean, default: false },
    notes: String,
  },
  { _id: false },
);

const ExtraSchema = new mongoose.Schema(
  {
    key: String,
    name: String,
    quantity: { type: Number, default: 1 },
    price: { type: Number, default: 0 }, // gross £ charged to client
    finishTime: String,
    arrivalTime: String,

    // Optional categorisation for admin / payout logic
    category: String, // e.g. "pa_hire", "late_stay", "dj", "early_arrival"

    // How this extra was priced
    pricingMode: {
      type: String,
      enum: ["flat", "per_band_member", "per_specific_members", "manual"],
      default: "flat",
    },

    // Store underlying calculation inputs for audit / recomputation
    unitNetPrice: { type: Number, default: 0 }, // e.g. £50 per member per 60 mins
    unitGrossPrice: { type: Number, default: 0 },
    unitMinutes: { type: Number, default: 0 }, // e.g. 60
    appliedMinutes: { type: Number, default: 0 }, // e.g. 90
    billableMemberCount: { type: Number, default: 0 },
    marginMultiplier: { type: Number, default: 1 }, // e.g. 1.33

    // Explicit payout mapping for extras
    payoutAllocations: { type: [ExtraPayoutAllocationSchema], default: [] },

    // Convenience metadata
    payoutRoleFilter: [String], // e.g. ["Sound Engineering", "PA / Lights"]
    payoutMemberIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    ],
    payoutMemberNames: [String],

    // Specific support for PA/lights staying later than the band
    paLateStay: {
      enabled: { type: Boolean, default: false },
      onlySpecificMembers: { type: Boolean, default: false },
      memberCount: { type: Number, default: 0 },
      memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "musician" }],
      memberNames: [String],
      additionalMinutesBeyondBand: { type: Number, default: 0 },
      basedOnExtraKey: String, // e.g. "late_stay_60min_per_band_member"
    },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                                Performance                                 */
/* -------------------------------------------------------------------------- */

const PerformanceSchema = new mongoose.Schema(
  {
    arrivalTime: String, // "HH:MM"
    setupAndSoundcheckedBy: String, // "HH:MM"
    startTime: String, // "HH:MM"
    finishTime: String, // "HH:MM"
    finishDayOffset: { type: Number, default: 0 },

    // selected performance plan (evening set configuration)
    planIndex: { type: Number },
    plan: {
      sets: { type: Number },
      length: { type: Number },
      minInterval: { type: Number },
    },

    paLightsFinishTime: String,
    paLightsFinishDayOffset: { type: Number, default: 0 },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                         Call forwarding / proxy contact                     */
/* -------------------------------------------------------------------------- */

const ForwardTargetSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    name: String,
    role: String, // e.g. "PA / Sound", "Band Leader"
    phone: String, // E.164 (+44...)
    priority: { type: Number, default: 1 },
  },
  { _id: false },
);

const ProxyContactSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "twilio" },
    mode: {
      type: String,
      enum: ["pooled", "dedicated", "shared_ivr"],
      default: "pooled",
    },

    proxyNumber: String,
    allocation: {
      numberSid: String,
      allocatedAt: Date,
      releasedAt: Date,
    },

    ivrCode: String,
    ivrPin: String,

    webhookToken: String,

    activeFrom: Date,
    activeUntil: Date,

    recordingEnabled: { type: Boolean, default: false },
    voicemail: {
      enabled: { type: Boolean, default: false },
      emailForwardTo: String,
      transcription: { type: Boolean, default: true },
    },

    ringStrategy: { type: String, enum: ["simul", "hunt"], default: "hunt" },
    targets: [ForwardTargetSchema],

    calls: [
      {
        sid: String,
        from: String,
        to: String,
        startedAt: Date,
        durationSec: Number,
        outcome: {
          type: String,
          enum: ["completed", "no-answer", "busy", "failed", "voicemail"],
          default: "completed",
        },
        recordingUrl: String,
      },
    ],

    active: { type: Boolean, default: false },
    note: String,
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                                Act summary                                 */
/* -------------------------------------------------------------------------- */

const ActSummarySchema = new mongoose.Schema(
  {
    actId: { type: String, required: true },
    actName: String,

    lineupId: { type: String, required: true },
    lineupLabel: String,
    bandSize: Number,
    image: mongoose.Schema.Types.Mixed,

    chosenVocalists: [
      { musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician" } },
    ],

    // full lineup snapshot
    bandMembers: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lineup: { type: mongoose.Schema.Types.Mixed, default: null },

    quantity: { type: Number, default: 1 },
    prices: {
      base: { type: Number, default: 0 },
      travel: { type: Number, default: 0 },
      subtotalWithMargin: { type: Number, default: 0 },
      adjustedTotal: { type: Number, default: 0 },
    },

    selectedExtras: [ExtraSchema],
    performance: PerformanceSchema,
    dismissedExtras: [String],
    selectedAfternoonSets: [mongoose.Schema.Types.Mixed],
    allLineups: [mongoose.Schema.Types.Mixed],

    bandPointOfContact: {
      name: String,
      role: String,
      phone: String,
    },
    contactProxy: ProxyContactSchema,
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                                 Event sheet                                */
/* -------------------------------------------------------------------------- */

const EventSheetSchema = new mongoose.Schema(
  {
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    complete: { type: mongoose.Schema.Types.Mixed, default: {} },
    submitted: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now },
    emergencyContact: {
      number: String,
      ivrCode: String,
      note: {
        type: String,
        default:
          "Emergency contact active from 5pm the day before and on the event day.",
      },
      activeWindowSummary: String,
    },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                              Payout breakdown                               */
/* -------------------------------------------------------------------------- */

const PaymentExtraBreakdownSchema = new mongoose.Schema(
  {
    key: String,
    name: String,
    category: String,
    amount: { type: Number, default: 0 }, // net £ for this musician
    minutes: { type: Number, default: 0 },
    pricingMode: String,
    sourceExtraPrice: { type: Number, default: 0 }, // gross extra price on booking
    isLateStay: { type: Boolean, default: false },
    isPaLateStay: { type: Boolean, default: false },
    isPaHire: { type: Boolean, default: false },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                           Add-on payments (NEW)                             */
/* -------------------------------------------------------------------------- */

const AddonPaymentSchema = new mongoose.Schema(
  {
    // What kind of add-on this was (deposit or full add-on payment)
    stage: {
      type: String,
      enum: ["addon_deposit", "addon_full"],
      required: true,
    },

    // Amount charged (in minor units)
    amountPence: { type: Number, default: 0 },
    currency: { type: String, default: "GBP" },

    // Optional label to show in admin / for audit
    label: { type: String, default: "" },

    // Stripe references
    checkoutSessionId: { type: String, default: "" },
    checkoutUrl: { type: String, default: "" },
    paymentIntentId: { type: String, default: "" },
    chargeId: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "sent", "paid", "cancelled", "refunded"],
      default: "draft",
    },

    paidAt: { type: Date },
    createdAt: { type: Date, default: Date.now },

    // Extra audit payload (safe to store arbitrary metadata)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }, // keep _id so you can target/update a specific add-on later
);

/* -------------------------------------------------------------------------- */
/*                                  Booking                                   */
/* -------------------------------------------------------------------------- */

const BookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true },

    // User
    userId: { type: String, index: true },
    userEmail: { type: String, index: true },

    // Stripe
    sessionId: { type: String, index: true }, // initial checkout session (deposit/full)
    paymentIntentId: { type: String }, // initial payment intent
    chargeId: { type: String }, // initial charge id
    amount: { type: Number, default: 0 }, // last Stripe charge (major £)
    pdfUrl: { type: String },

    // Client-requested paperwork flag (mainly corporates)
    invoiceRequested: { type: Boolean, default: false },

    // Accounting split for Stripe-first revenue model
    // - commission* is your revenue (VAT-able)
    // - passThrough* is client money held to pay musicians
    accounting: {
      invoiceCompany: {
        type: String,
        enum: ["TSC", "BMM"],
        default: "TSC",
      },
      paymentStage: {
        type: String,
        enum: ["deposit", "balance", "full", "addon_deposit", "addon_full", ""],
        default: "",
      },
      vatRate: { type: Number, default: 0.2 },
      commissionGross: { type: Number, default: 0 },
      commissionVat: { type: Number, default: 0 },
      commissionNet: { type: Number, default: 0 },
      passThroughGross: { type: Number, default: 0 },
      currency: { type: String, default: "GBP" },
    },

    // Payment method/status
    paymentMethod: { type: String },

    // Legacy boolean (keep for backwards compatibility)
    payment: { type: Boolean, default: false },

    // Preferred payment status flag
    paymentStatus: {
      type: String,
      enum: [
        "unpaid",
        "paid",
        "refunded",
        "partially_refunded",
        "disputed",
        "failed",
      ],
      default: "unpaid",
      index: true,
    },

    /* ---------------------------- Balance handling ---------------------------- */

    invoiceCompany: {
      type: String,
      enum: ["TSC", "BMM"],
      default: "TSC",
    },
    balanceInvoiceUrl: { type: String },
    balanceInvoiceId: { type: String },
    stripeInvoiceId: { type: String }, // (if you ever use Stripe Invoices API)
    balancePaid: { type: Boolean, default: false },
    status: { type: String, required: true, default: "pending" },
    balanceDueAt: { type: Date },
    balanceAmountPence: { type: Number },
    balanceStatus: {
      type: String,
      enum: ["scheduled", "sent", "paid", "overdue", "cancelled"],
      default: undefined,
    },

    // Stripe invoice / paylink mirrors (so admin board can always show Pay + Invoice)
    paymentLink: { type: String, default: "" }, // hosted_invoice_url
    invoicePdfUrl: { type: String, default: "" }, // invoice_pdf
    balanceInvoicePdfUrl: { type: String, default: "" }, // balance invoice_pdf

    /* ------------------------- Multiple add-on payments ------------------------ */

    addonPayments: { type: [AddonPaymentSchema], default: [] },

    /* ---------------------------- Per-musician payouts ------------------------- */

    payments: [
      {
        musician: { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
        performanceFee: Number,
        travelFee: Number,
        extrasFee: { type: Number, default: 0 }, // summed net extras owed to this musician
        extrasBreakdown: {
          type: [PaymentExtraBreakdownSchema],
          default: [],
        },
        isPaid: { type: Boolean, default: false },
        paidAt: Date,
      },
    ],

    paymentComputation: {
      extrasLastCalculatedAt: Date,
      extrasCalculationVersion: String,
      notes: String,
    },

    bandPaymentsSent: { type: Boolean, default: false },

    // Emergency contact routing
    contactRouting: ProxyContactSchema,

    // Event sheet
    eventSheet: EventSheetSchema,

    // Manual booking helpers
    lineup: mongoose.Schema.Types.Mixed,
    eventDate: { type: Date },
    clientName: { type: String },
    clientEmail: { type: String },
    clientPhone: { type: String },
    feeDetails: mongoose.Schema.Types.Mixed,
    notes: { type: String },
    createdManually: { type: Boolean, default: false },

    notifiedAt: { type: Date },
  },
  { timestamps: true },
);

/* -------------------------------------------------------------------------- */
/*                                   Indexes                                  */
/* -------------------------------------------------------------------------- */

// One-and-only one bookingId, but ignore docs that don't have a string bookingId yet.
BookingSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { bookingId: { $type: "string" } } },
);

// in bookingModel.js, after schema definition
BookingSchema.pre("validate", function (next) {
  if (!this.bookingId) {
    const last = this.clientName || this.userAddress?.lastName || "CLIENT";
    const d = this.date || this.eventDate || new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(10000 + Math.random() * 90000);
    const safeLast = String(last)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    this.bookingId = `${yy}${mm}${dd}-${safeLast}-${rand}`;
  }
  next();
});

BookingSchema.index({ "contactRouting.ivrCode": 1 }, { sparse: true });

// Bookings by musician payouts
BookingSchema.index({ "payments.musician": 1 });

// Bookings by event date
BookingSchema.index({ date: 1 });

// Bookings by status
BookingSchema.index({ status: 1 });

// Bookings by act
BookingSchema.index({ act: 1 });

// Bookings by Stripe IDs
BookingSchema.index({ sessionId: 1 });
BookingSchema.index({ paymentIntentId: 1 }, { sparse: true });

// NEW: helpful lookups for add-on payments
BookingSchema.index({ "addonPayments.checkoutSessionId": 1 }, { sparse: true });
BookingSchema.index({ "addonPayments.paymentIntentId": 1 }, { sparse: true });

const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

export default Booking;
