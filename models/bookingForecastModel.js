import mongoose from "mongoose";

const supplierPaymentSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    role: { type: String, trim: true },
    amount: { type: Number, default: 0 },
    expectedPaymentDate: Date,
    paid: { type: Boolean, default: false },
    actualPaymentDate: Date,
    notes: String,
  },
  { _id: true },
);

const bookingForecastSchema = new mongoose.Schema(
  {
    // Core identifiers
    bookingRef: { type: String, trim: true },
    mondayItemName: { type: String, trim: true },
    mondayGroup: String, // Leads / Open Enquiries, Booked, Past Clients
    bookingReferral: String,

    // CRM ownership + status
    owner: String,
    stage: String,
    status: String,

    // Client details
    clientNames: String,
    firstName: String,
    lastName: String,
clientEmail: { type: String, trim: true, lowercase: true },
clientPhone: { type: String, trim: true },
    postcode: String,

    // Event details
    bookingMadeDate: Date,
    eventDate: Date,
    eventDateForEmail: String,
    eventType: String,
    weddingStatus: {
      type: String,
      enum: ["Wedding", "Non-Wedding", ""],
      default: "",
    },
    birthdayOrYourName: String,
    guestsLabel: String,
    county: String,
    fullAddress: String,

    // Band details
    tscBandName: String,
    bookedBandName: String,
    actName: String,
    lineup: String,
    bandSize: String,
    leadSingers: String,
    vocalistName: String,
    vocalistEmail: String,
    bandMembers: String,
    allocated: String,
    teamStatus: String,

    // Add-ons / planning
    firstDanceOrOffRepRequest: String,
    bookedMannedPlaylist: { type: Boolean, default: false },
    bookedDj: { type: Boolean, default: false },

    // Links
    eventSheetLink: String,
    invoiceLink: String,
    whatsappGroupLink: String,

    // Workflow dates
    songSuggestionsDueDate: Date,
    songSuggestionsDueDateForEmail: String,
    eventSheetCompleteDate: Date,
    eventSheetCompleteDateForEmail: String,
    sendDate: Date,

    // Workflow statuses
    eventSheetStatus: String,
    whatsappGroupSetUp: String,
    setlistSharedOnGroupChat: Boolean,
    sendIntroEmail: { type: Boolean, default: false },
    paid: { type: Boolean, default: false },
    removeUnsubDoesntWork: Boolean,

    // Reviews / post-event
    dontRequestReview: Boolean,
    review: String,
    givenNonGoogleReview: Boolean,
    givenGoogleReview: Boolean,
    givenPhotosVideos: Boolean,
    socialMediaContent: Boolean,
    manualReviewRequestSent: Boolean,

    // Finance
    source: { type: String, trim: true, default: "Other" },
    agent: String,
    dealValue: { type: Number, default: 0 },
    grossBookingValue: { type: Number, default: 0 },
    totalBookingValue: { type: Number, default: 0 },
    depositAmount: { type: Number, default: 0 },
    balanceAmount: { type: Number, default: 0 },
    expectedDepositDate: Date,
    actualDepositDate: Date,
    depositPaid: { type: Boolean, default: false },
    expectedBalanceDate: Date,
    actualBalanceDate: Date,
    balancePaid: { type: Boolean, default: false },

    ewanFee: { type: Number, default: 0 },
    bmmFee: { type: Number, default: 0 },
    rhonaFee: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },

    supplierPayments: [supplierPaymentSchema],

    // Notes
    outstandingPoints: String,
    notes: String,
    mondayText: String,
    checkbox: Boolean,
  },
  { timestamps: true },
);

bookingForecastSchema.index({ eventDate: 1 });
bookingForecastSchema.index({ source: 1 });
bookingForecastSchema.index({ bookingRef: 1 });

const BookingForecast =
  mongoose.models.BookingForecast ||
  mongoose.model("BookingForecast", bookingForecastSchema);

export default BookingForecast;
