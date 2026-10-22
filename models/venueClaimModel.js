import mongoose from "mongoose";

const VenueClaimSchema = new mongoose.Schema(
  {
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    contactName: { type: String, default: "", trim: true },
    contactEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    contactRole: { type: String, default: "", trim: true },
    requestMessage: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["requested", "invited", "submitted", "approved", "rejected", "expired"],
      default: "requested",
      index: true,
    },
    tokenHash: { type: String, default: "", index: true },
    expiresAt: Date,
    proposed: { type: mongoose.Schema.Types.Mixed, default: {} },
    proposedPhotoUrl: { type: String, default: "" },
    proposedPhotoPublicId: { type: String, default: "" },
    partnershipInterest: { type: Boolean, default: false },
    partnershipMessage: { type: String, default: "", trim: true },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

VenueClaimSchema.index({ venueId: 1, contactEmail: 1, status: 1 });

export default mongoose.models.VenueClaim || mongoose.model("VenueClaim", VenueClaimSchema);
