import mongoose from "mongoose";

const EmailSchema = new mongoose.Schema({
  label: { type: String },          // e.g. "Bride", "Planner"
  email: { type: String, required: true },
}, { _id: false });

const AllocationSchema = new mongoose.Schema({
  status: { type: String, enum: ["not_started","in_progress","fully_allocated","gap"], default: "not_started" },
  lastCheckedAt: { type: Date },
  notes: { type: String },
  // optional: who/role gaps you still need
  gaps: [{ instrument: String, needed: Number }],
}, { _id: false });

const ReviewSchema = new mongoose.Schema({
  requestedCount: { type: Number, default: 0 },
  lastRequestedAt: { type: Date },
  received: { type: Boolean, default: false },
  link: { type: String },           // internal review URL or Trustpilot/Google
  source: { type: String, enum: ["internal","google","trustpilot","other"], default: "internal" }
}, { _id: false });

const PaymentsSchema = new mongoose.Schema({
  balanceInvoiceUrl: { type: String },      // Stripe hosted invoice link
  balancePaymentReceived: { type: Boolean, default: false },
  depositAmount: { type: Number },              // £ deposit expected (from Stripe/cart)
  depositChargedAmount: { type: Number },       // £ actually charged on Stripe
  bandPaymentsSent: { type: Boolean, default: false },
  bandPayments: [{
    musicianId: mongoose.Types.ObjectId,
    amount: Number,
    sentAt: Date,
    method: { type: String, enum: ["bacs","manual","stripe_connect","other"] }
  }]
}, { _id: false });

const BookingDetailsSchema = new mongoose.Schema({
  eventType: { type: String },      // Wedding, Corporate, etc.
  ceremony: { start: String, end: String, notes: String },
  afternoon: { start: String, end: String, notes: String },
  evening: {
    arrivalTime: String,
    finishTime: String,
    sets: [{ start: String, end: String, length: String }], // e.g. 2x60
    notes: String
  },
  djServicesBooked: { type: Boolean, default: false }
}, { _id: false });

const BookingBoardItemSchema = new mongoose.Schema({
  // link to core booking if exists
  bookingId: { type: mongoose.Types.ObjectId, ref: "Booking" },

  // visible columns
  bookerName: { type: String },
  clientFirstNames: { type: String },
  bookingRef: { type: String, index: true, unique: false },
  eventSheetLink: { type: String },
  contractUrl: { type: String },                   // link to generated contract PDF/HTML
  eventDateISO: { type: String, index: true },                   // "2025-09-20"
  enquiryDateISO: { type: String },                // "yyyy-mm-dd" — first contact
  bookingDateISO: { type: String },                // "yyyy-mm-dd" — when confirmed/paid
  grossValue: { type: Number, default: 0 },
  netCommission: { type: Number, default: 0 },                   // agency commission amount £
  agent: { type: String },                                       // e.g. "Encore", "TSC Direct", "Other Agent"
  clientEmails: [EmailSchema],
  eventType: { type: String },
  actName: { type: String },
  actTscName: { type: String },
  address: { type: String },
  county: { type: String },
  payments: PaymentsSchema,

  bandSize: { type: Number, default: 0 },                        // excluding manager
  lineupSelected: { type: String },                              // human label e.g. "6-Piece (2xVoc, Sax, Gtr, Bass, Drums)"
  lineupComposition: [{ type: String }],           // e.g. ["Lead Vocal","Guitar","Bass","Drums"]
  arrivalTime: { type: String },                                 // “17:30”
  finishTime: { type: String },                    // “23:30”

  bookingDetails: BookingDetailsSchema,
  allocation: AllocationSchema,
  review: ReviewSchema,

  // access control helpers
  actOwnerMusicianId: { type: mongoose.Types.ObjectId },         // so act owners see only their rows
  visibility: {
    grossAndCommissionVisibleToAdminOnly: { type: Boolean, default: true }
  },

  // denorm for speed
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model("BookingBoardItem", BookingBoardItemSchema);