import mongoose from "mongoose";

const EnquiryBoardItemSchema = new mongoose.Schema(
  {
    // Identifiers / reference
    enquiryRef: { type: String, index: true },            // human-friendly ref (not unique)
    enquiryId: { type: mongoose.Types.ObjectId, ref: "Enquiry" }, // optional link to a core enquiry

    // Source (agent)
    agent: { type: String, index: true },                 // e.g. "Direct", "Encore", etc.

    // Dates
    enquiryDateISO: { type: String, index: true },        // "YYYY-MM-DD"
    eventDateISO: { type: String, index: true },          // "YYYY-MM-DD"

    // Act names
    actName: { type: String, index: true },
    actTscName: { type: String, index: true },

    // Location
    address: { type: String },                            // venue/address
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
    grossValue: { type: Number, default: 0 },             // potential gross booking value £
    netCommission: { type: Number, default: 0 },          // potential commission amount £ (e.g., 25%)

    // Quoted details
    bandSize: { type: Number, default: 0 },               // band size quoted (excludes manager)
    maxBudget: { type: Number },                          // client's maximum budget (if provided)
  },
  { timestamps: true }
);

export default mongoose.model("EnquiryBoardItem", EnquiryBoardItemSchema);