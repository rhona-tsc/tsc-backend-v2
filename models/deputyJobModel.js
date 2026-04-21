// models/deputyJobModel.js
import mongoose from "mongoose";

const deputyJobApplicationSchema = new mongoose.Schema(
  {
    musicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      index: true,
    },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    appliedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: [
        "applied",
        "shortlisted",
        "allocated",
        "booked",
        "declined",
        "withdrawn",
        "presented",
      ],
      default: "applied",
      
    },
    notes: { type: String, default: "", trim: true },

    deputyMatchScore: { type: Number, default: 0 },
    matchSummary: {
      instrument: { type: String, default: "" },
      roleFit: { type: Number, default: 0 },
      genreFit: { type: Number, default: 0 },
      locationFit: { type: Number, default: 0 },
      songFit: { type: Number, default: 0 },
    },

    shortlistedAt: { type: Date, default: null },
    presentedAt: { type: Date, default: null },
    allocatedAt: { type: Date, default: null },
    bookedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
  },
  { _id: false },
);

const deputyJobNotificationSchema = new mongoose.Schema(
  {
    musicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      index: true,
      default: null,
    },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    channel: {
      type: String,
      enum: ["email", "whatsapp"],
      default: "email",
    },
    type: {
      type: String,
      enum: [
        "job_created_preview",
        "job_created",
        "job_created_corrected",
        "application_received_preview",
        "application_received",
        "allocation_preview",
        "allocation",
        "allocation_request",
        "booking_confirmation_preview",
        "booking_confirmation",
        "allocation_request_manua",
        "manual",
"applicant_presented",
        
      ],
      default: "job_created",
    },
    subject: { type: String, default: "", trim: true },
    previewHtml: { type: String, default: "" },
    previewText: { type: String, default: "" },
    providerMessageId: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["preview", "queued", "sent", "failed", "skipped"],
      default: "sent",
    },
    sentAt: { type: Date, default: Date.now },
    error: { type: String, default: "" },
  },
  { _id: false },
);

const deputyJobMatchSnapshotSchema = new mongoose.Schema(
  {
    musicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      index: true,
    },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    profilePicture: { type: String, default: "", trim: true },
    musicianSlug: { type: String, default: "", trim: true },
    deputyMatchScore: { type: Number, default: 0 },
    matchPct: { type: Number, default: 0 },
    matchSummary: {
      instrument: { type: String, default: "" },
      roleFit: { type: Number, default: 0 },
      genreFit: { type: Number, default: 0 },
      locationFit: { type: Number, default: 0 },
      songFit: { type: Number, default: 0 },
    },
    notified: { type: Boolean, default: false },
    notifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const deputyJobPaymentEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "setup_intent_created",
        "setup_intent_succeeded",
        "payment_method_saved",
        "charge_requested",
        "payment_intent_created",
        "payment_succeeded",
        "payment_failed",
        "payment_cancelled",
        "payout_marked_pending",
        "payout_marked_paid",
        "payout_transfer_failed",
        "payout_transfer_succeeded",
        "manual_adjustment",
      ],
      default: "manual_adjustment",
    },
    status: { type: String, default: "" },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "GBP", trim: true, uppercase: true },
    stripeCustomerId: { type: String, default: "", trim: true },
    setupIntentId: { type: String, default: "", trim: true },
    paymentIntentId: { type: String, default: "", trim: true },
    paymentMethodId: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const deputyJobSchema = new mongoose.Schema(
  {
    title: { type: String, default: "", trim: true },

    instrument: { type: String, required: true, trim: true, index: true },
    requiredInstruments: { type: [String], default: [] },
    isVocalSlot: { type: Boolean, default: false },

    // canonical + aliases for frontend convenience
    eventDate: { type: String, default: "", index: true },
    date: { type: String, default: "", index: true },

    startTime: { type: String, default: "" },
    callTime: { type: String, default: "" },

    endTime: { type: String, default: "" },
    finishTime: { type: String, default: "" },

    venue: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    locationName: { type: String, default: "", trim: true },
    county: { type: String, default: "", trim: true, index: true },
    postcode: { type: String, default: "", trim: true },
    jobType: {
      type: String,
      enum: ["booked", "enquiry"],
      default: "booked",
    },


    genres: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    essentialRoles: { type: [String], default: [] },
    requiredSkills: { type: [String], default: [] },
    desiredRoles: { type: [String], default: [] },
    secondaryInstruments: { type: [String], default: [] },

    setLengths: { type: [String], default: [] },

    whatsIncluded: { type: [String], default: [] },
    whatsIncludedOther: { type: String, default: "", trim: true },

    claimableExpenses: { type: [String], default: [] },
    claimableExpensesOther: { type: String, default: "", trim: true },

    fee: { type: Number, default: 0 },
    currency: { type: String, default: "GBP", trim: true, uppercase: true },
    notes: { type: String, default: "", trim: true },
    stripeFeeAmount: { type: Number, default: 0 },
    clientName: { type: String, default: "", trim: true },
    clientEmail: { type: String, default: "", trim: true, lowercase: true },
    clientPhone: { type: String, default: "", trim: true },

    stripeCustomerId: { type: String, default: "", trim: true, index: true },
    defaultPaymentMethodId: { type: String, default: "", trim: true },
    setupIntentId: { type: String, default: "", trim: true },
    setupIntentStatus: { type: String, default: "", trim: true },
    paymentIntentId: { type: String, default: "", trim: true },
    paymentIntentStatus: { type: String, default: "", trim: true },
    latestTransferId: { type: String, default: "", trim: true },

    grossAmount: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    deputyNetAmount: { type: Number, default: 0 },

   paymentStatus: {
  type: String,
  enum: [
    "not_started",
    "setup_required",
    "setup_pending",
    "ready_to_charge",
    "charge_pending",
    "paid",
    "failed",
    "refunded",
    "cancelled",
    "not_required",
  ],
  default: "not_started",
  index: true,
},

    releaseOn: { type: Date, default: null, index: true },
    chargedAt: { type: Date, default: null },
    payoutScheduledAt: { type: Date, default: null },
    payoutPaidAt: { type: Date, default: null },
    paymentFailureReason: { type: String, default: "", trim: true },

    paymentEvents: { type: [deputyJobPaymentEventSchema], default: [] },

    status: {
  type: String,
  enum: ["draft", "preview", "open", "allocated", "filled", "closed", "cancelled"],
  default: "open",
  index: true,
},

    workflowStage: {
      type: String,
      enum: [
        "created",
        "preview_ready",
        "payment_setup_required",
        "awaiting_card_setup",
        "ready_to_charge",
        "sent_to_matches",
        "applications_open",
        "allocated",
        "booking_confirmed",
        "closed",
      ],
      default: "created",
    },
    isEnquiryOnly: {
      type: Boolean,
      default: false,
    },
    previewMode: { type: Boolean, default: false },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      index: true,
    },
    createdByName: { type: String, default: "" },
    createdByEmail: { type: String, default: "", trim: true, lowercase: true },
    createdByPhone: { type: String, default: "", trim: true },
    applications: { type: [deputyJobApplicationSchema], default: [] },

    matchedMusicianIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    ],
    matchedMusicians: { type: [deputyJobMatchSnapshotSchema], default: [] },

    notifiedMusicianIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    ],

    notifications: { type: [deputyJobNotificationSchema], default: [] },

    matchedCount: { type: Number, default: 0 },
    notifiedCount: { type: Number, default: 0 },
    applicationCount: { type: Number, default: 0 },

    allocatedMusicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      default: null,
      index: true,
    },
    allocatedMusicianName: { type: String, default: "" },
    allocatedAt: { type: Date, default: null },

    bookedMusicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      default: null,
      index: true,
    },
    bookedMusicianName: { type: String, default: "" },
    bookingConfirmedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

deputyJobSchema.index({ createdAt: -1 });
deputyJobSchema.index({ status: 1, createdAt: -1 });
deputyJobSchema.index({ status: 1, jobType: 1 });
deputyJobSchema.index({ createdBy: 1, createdAt: -1 });
deputyJobSchema.index({ eventDate: 1 });
deputyJobSchema.index({ allocatedMusicianId: 1, eventDate: 1 });
deputyJobSchema.index({ bookedMusicianId: 1, eventDate: 1 });
deputyJobSchema.index({ stripeCustomerId: 1, createdAt: -1 });
deputyJobSchema.index({ paymentStatus: 1, releaseOn: 1, createdAt: -1 });
deputyJobSchema.index({ payoutStatus: 1, releaseOn: 1, createdAt: -1 });

const deputyJobModel =
  mongoose.models.deputyjob || mongoose.model("deputyjob", deputyJobSchema);

export default deputyJobModel;
