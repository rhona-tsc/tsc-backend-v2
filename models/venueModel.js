import mongoose from "mongoose";

const SourceSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["booking", "event_sheet", "calendar", "manual", "musician_feedback"], default: "manual" },
    sourceId: { type: String, default: "" },
    title: { type: String, default: "" },
    url: { type: String, default: "" },
    eventDate: Date,
    importedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const RoomSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Main / unspecified room", trim: true },
    aliases: { type: [String], default: [] },
    performanceArea: { type: String, default: "" },
    accessAndLoading: { type: String, default: "" },
    changingRoom: { type: String, default: "" },
    soundLimitations: { type: String, default: "" },
    soundLimiterDb: { type: String, default: "" },
    curfewAndCloseTime: { type: String, default: "" },
    paAndLighting: { type: String, default: "" },
    powerAndStage: { type: String, default: "" },
    capacity: { type: String, default: "" },
    notes: { type: String, default: "" },
    sources: { type: [SourceSchema], default: [] },
  },
  { timestamps: true },
);

const VisitSchema = new mongoose.Schema(
  {
    bookingId: { type: String, default: "", index: true },
    eventDate: Date,
    actId: { type: String, default: "" },
    actName: { type: String, default: "" },
    roomName: { type: String, default: "" },
    clientName: { type: String, default: "" },
    sourceUrl: { type: String, default: "" },
  },
  { _id: false },
);

const FeedbackSchema = new mongoose.Schema(
  {
    authorName: { type: String, default: "" },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "musician" },
    role: { type: String, default: "" },
    roomName: { type: String, default: "" },
    bookingId: { type: String, default: "" },
    note: { type: String, required: true, trim: true },
    eventDate: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const VenueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    normalizedKey: { type: String, required: true, unique: true, index: true },
    aliases: { type: [String], default: [] },
    address: { type: String, default: "" },
    postcode: { type: String, default: "", index: true },
    county: { type: String, default: "" },
    website: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    photoPublicId: { type: String, default: "" },
    photoAlt: { type: String, default: "" },
    photoSourceUrl: { type: String, default: "" },
    googleMapsUrl: { type: String, default: "" },
    what3wordsUrl: { type: String, default: "" },
    loadingPinUrl: { type: String, default: "" },
    parking: { type: String, default: "" },
    parkingPinUrl: { type: String, default: "" },
    generalDirections: { type: String, default: "" },
    supplierRequirements: { type: String, default: "" },
    supplierFormUrls: { type: [String], default: [] },
    contacts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    generalNotes: { type: String, default: "" },
    rooms: { type: [RoomSchema], default: [] },
    visits: { type: [VisitSchema], default: [] },
    feedback: { type: [FeedbackSchema], default: [] },
    sources: { type: [SourceSchema], default: [] },
    reviewStatus: { type: String, enum: ["review_needed", "reviewed"], default: "review_needed", index: true },
    lastVerifiedAt: Date,
  },
  { timestamps: true },
);

export default mongoose.models.Venue || mongoose.model("Venue", VenueSchema);
