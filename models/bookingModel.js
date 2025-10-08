// models/bookingModel.js
import mongoose from "mongoose";

const ExtraSchema = new mongoose.Schema(
  {
    key: String,
    name: String,
    quantity: { type: Number, default: 1 },
    price: { type: Number, default: 0 }, // gross £ you charge
    finishTime: String,
    arrivalTime: String,
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
    afternoonSets: [mongoose.Schema.Types.Mixed],
    allLineups: [mongoose.Schema.Types.Mixed],

    bandPointOfContact: {
      name: String,
      role: String,
      phone: String, // real phone (not shown to client)
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
      number: String, // public proxy DID or IVR number
      ivrCode: String,
      note: {
        type: String,
        default:
          "Emergency contact active from 5pm the day before and on the event day.",
      },
      activeWindowSummary: String, // e.g. "Fri 5pm → Sun 2am"
    },
  },
  { _id: false }
);

const BookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, index: true },
    // User
    userId: { type: String, index: true },
    userEmail: { type: String, index: true },

    // Stripe
    sessionId: { type: String },
    amount: { type: Number, default: 0 }, // last Stripe charge (major £)
    // Success page → contract step stores the PDF here:
    pdfUrl: { type: String },

    // Google Calendar mirror (set when we update/create a calendar event)
    calendarEventId: { type: String },

    // Core details
    act: { type: String, index: true }, // primary act id (string is fine)
    lineupId: { type: String }, // chosen lineup id
    bandLineup: [{ type: mongoose.Schema.Types.ObjectId, ref: "musician" }], // confirmed players
    venue: { type: String }, // short venue name
    venueAddress: { type: String }, // full address (existing)
    eventType: { type: String },
    date: { type: Date, default: Date.now }, // event date (existing)
    fee: { type: Number, default: 0 }, // manual/legacy fee
    agent: { type: String }, // e.g. "TSC Direct", partner name

    actsSummary: [ActSummarySchema], // (existing, used by pricing/board)
performanceTimes: PerformanceSchema, 
    // Customer
    userAddress: mongoose.Schema.Types.Mixed,
    signatureUrl: { type: String },

    // Totals (Stripe-facing)
    totals: {
      fullAmount: { type: Number, default: 0 }, // gross £
      depositAmount: { type: Number, default: 0 }, // suggested deposit £
      chargedAmount: { type: Number, default: 0 }, // what Stripe actually charged
      chargeMode: { type: String, enum: ["deposit", "full", ""], default: "" },
      isLessThanFourWeeks: { type: Boolean, default: false },
      currency: { type: String, default: "GBP" },
    },

    // Cart metadata (unchanged)
    cartMeta: {
      selectedAddress: String,
      selectedDate: String,
      currency: { type: String, default: "GBP" },
    },

    // Payment method/status (unchanged)
    paymentMethod: { type: String },
    payment: { type: Boolean, default: false },

    // Admin/board balance status
    balanceInvoiceUrl: { type: String }, // Stripe hosted invoice for balance
    balancePaid: { type: Boolean, default: false }, // for the “Paid” pill on the board
    status: { type: String, required: true, default: "pending" },
    balanceDueAt: { type: Date }, // when the balance is due (14 days pre-event)
    balanceAmountPence: { type: Number }, // remaining balance (in pence)
    balanceStatus: {
      type: String,
      enum: ["scheduled", "sent", "paid", "overdue", "cancelled"],
      default: undefined,
    },
    stripeInvoiceId: { type: String }, // optional Stripe invoice id for the balance
    balanceInvoiceId: { type: String }, // internal id if you later add an Invoice collection

    // Per-musician payouts (existing)
    payments: [
      {
        musician: { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
        performanceFee: Number,
        travelFee: Number,
        isPaid: { type: Boolean, default: false },
        paidAt: Date,
      },
    ],
    bandPaymentsSent: { type: Boolean, default: false },

    // Emergency contact routing for this booking (existing)
    contactRouting: ProxyContactSchema,

    // Event sheet (existing)
    eventSheet: EventSheetSchema,

    // Manual booking helpers (used by manualCreateBooking route)
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
    // lazy import to avoid circular dep; or duplicate tiny helper here
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

const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

export default Booking;
