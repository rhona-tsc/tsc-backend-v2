// models/enquiryBoardItem.js
import mongoose from "mongoose";
import { marketingAttributionSchema } from './marketingAttributionSchema.js';

const EnquiryBoardItemSchema = new mongoose.Schema(
  {
    // Identifiers / reference
    enquiryRef: { type: String, index: true },
    enquiryTopic: { type: String, enum: ['client_event', 'human_callback', 'musician_job', 'musician_joining'], default: undefined },
    musicianRole: { type: String, maxlength: 120 },
    jobReference: { type: String, maxlength: 200 },
    websiteKey: { type: String, unique: true, sparse: true },
    measurementId: { type: String },
    marketingSource: { type: String },
    attribution: { type: marketingAttributionSchema, default: undefined },
    enquiryId: { type: mongoose.Types.ObjectId, ref: "Enquiry" },

    // ✅ Add these so we can trigger availability properly
    actId: { type: mongoose.Types.ObjectId, ref: "Act", index: true }, // <-- IMPORTANT
    lineupId: { type: String, index: true },                           // optional (string/uuid)
    styles: { type: [String], default: [] },
    preferredSize: { type: String, default: '', maxlength: 80 },
    styleMatch: { type: String, enum: ['any', 'all'], default: 'any' },
    mustHaveInstruments: { type: [String], default: [] },
    selectedBands: { type: [new mongoose.Schema({
      actId: { type: mongoose.Schema.Types.ObjectId, ref: 'Act' },
      name: { type: String, maxlength: 160 },
      lineupId: { type: String, maxlength: 100 },
    }, { _id: false })], default: [] },

    // ✅ Client identity (for sending emails!)
    clientName: { type: String },
    clientPhone: { type: String },
    // Inert test artefact only; no scheduler consumes this field.
    availabilityRequestTest: { type: mongoose.Schema.Types.Mixed, default: undefined },
    clientEmail: { type: String, index: true },

    // Source (agent)
    agent: { type: String, index: true },

    // Dates
    enquiryDateISO: { type: String, index: true },
    eventDateISO: { type: String, index: true },

    // Act names (still useful for quick viewing/search)
    actName: { type: String, index: true },
    actTscName: { type: String, index: true },

    // Location
    address: { type: String },
    county: { type: String, index: true },

    // Notes + status
    notes: { type: String },
    status: {
      type: String,
      enum: ["open", "contacted", "qualified", "closed_won", "closed_lost"],
      default: "open",
      index: true,
    },

    // Money (potentials)
    grossValue: { type: Number, default: 0 },
    netCommission: { type: Number, default: 0 },

    // Quoted details
    bandSize: { type: Number, default: 0 },
    maxBudget: { type: Number },
  },
  { timestamps: true }
);

export default mongoose.model("EnquiryBoardItem", EnquiryBoardItemSchema);
