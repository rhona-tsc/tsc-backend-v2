// models/bookingModel.js
import mongoose from "mongoose";

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
  { _id: false }
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
    unitNetPrice: { type: Number, default: 0 },   // e.g. £50 per member per 60 mins
    unitGrossPrice: { type: Number, default: 0 },
    unitMinutes: { type: Number, default: 0 },    // e.g. 60
    appliedMinutes: { type: Number, default: 0 }, // e.g. 90
    billableMemberCount: { type: Number, default: 0 },
    marginMultiplier: { type: Number, default: 1 }, // e.g. 1.33

    // Explicit payout mapping for extras
    payoutAllocations: { type: [ExtraPayoutAllocationSchema], default: [] },

    // Convenience metadata
    payoutRoleFilter: [String], // e.g. ["Sound Engineering", "PA / Lights"]
    payoutMemberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "musician" }],
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
  { _id: false }
);

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
  { _id: false }
);

// ---- Call forwarding / proxy contact schemas ----
const ForwardTargetSchema = new mongoose.Schema(
  {
    musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    name: String,
    role: String, // e.g. "PA / Sound", "Band Leader"
    phone: String, // E.164 (+44...)
    priority: { type: Number, default: 1 },
  },
  { _id: false }
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
  { _id: false }
);

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
  { _id: false }
);

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
  { _id: false }
);

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
  { _id: false }
);

const BookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true },

    // User
    userId: { type: String, index: true },
    userEmail: { type: String, index: true },

    // Stripe
    sessionId: { type: String },
    amount: { type: Number, default: 0 }, // last Stripe charge (major £)
    pdfUrl: { type: String },

    // Google Calendar mirror
    calendarEventId: { type: String },

    // Core details
    act: { type: String },
    lineupId: { type: String },
    bandLineup: [{ type: mongoose.Schema.Types.ObjectId, ref: "musician" }],
    venue: { type: String },
    venueAddress: { type: String },
    eventType: { type: String },
    date: { type: Date, default: Date.now },
    fee: { type: Number, default: 0 },
    agent: { type: String },

    actsSummary: [ActSummarySchema],
    performanceTimes: PerformanceSchema,

    // Customer
    userAddress: mongoose.Schema.Types.Mixed,
    signatureUrl: { type: String },

    // Totals
    totals: {
      fullAmount: { type: Number, default: 0 }, // gross £
      depositAmount: { type: Number, default: 0 },
      chargedAmount: { type: Number, default: 0 },
      chargeMode: { type: String, enum: ["deposit", "full", ""], default: "" },
      isLessThanFourWeeks: { type: Boolean, default: false },
      currency: { type: String, default: "GBP" },
    },

    // Cart metadata
    cartMeta: {
      selectedAddress: String,
      selectedDate: String,
      currency: { type: String, default: "GBP" },
    },

    // Payment method/status
    paymentMethod: { type: String },
    payment: { type: Boolean, default: false },

    // Admin/board balance status
    balanceInvoiceUrl: { type: String },
    balancePaid: { type: Boolean, default: false },
    status: { type: String, required: true, default: "pending" },
    balanceDueAt: { type: Date },
    balanceAmountPence: { type: Number },
    balanceStatus: {
      type: String,
      enum: ["scheduled", "sent", "paid", "overdue", "cancelled"],
      default: undefined,
    },
    stripeInvoiceId: { type: String },
    balanceInvoiceId: { type: String },

    // Per-musician payouts
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
  { timestamps: true }
);

// One-and-only one bookingId, but ignore docs that don't have a string bookingId yet.
BookingSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { bookingId: { $type: "string" } } }
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

const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

export default Booking;