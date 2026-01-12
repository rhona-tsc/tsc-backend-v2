// models/enquiryBoardItem.js
import mongoose from "mongoose";

const EnquiryBoardItemSchema = new mongoose.Schema(
  {
    // Identifiers / reference
    enquiryRef: { type: String, index: true },
    enquiryId: { type: mongoose.Types.ObjectId, ref: "Enquiry" },

    // ✅ Add these so we can trigger availability properly
    actId: { type: mongoose.Types.ObjectId, ref: "Act", index: true }, // <-- IMPORTANT
    lineupId: { type: String, index: true },                           // optional (string/uuid)

    // ✅ Client identity (for sending emails!)
    clientName: { type: String },
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