import mongoose from "mongoose";

const DeputyOpportunityApplicationSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeputyOpportunity",
      required: true,
      index: true,
    },
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Musician",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "applied",
        "shortlisted",
        "allocated",
        "withdrawn",
        "unsuccessful",
      ],
      default: "applied",
      index: true,
    },

    applicationMessage: { type: String, default: "", trim: true },

    profileSnapshot: {
      name: String,
      email: String,
      phone: String,
      postcode: String,
      county: String,
      instruments: [String],
      vocals: [String],
      hasPA: Boolean,
      hasLighting: Boolean,
      hasDJGear: Boolean,
      hasTransport: Boolean,
      profileImage: String,
      musicianSlug: String,
    },

    matchScoreSnapshot: { type: Number, default: 0 },
    creatorViewedAt: { type: Date, default: null },
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DeputyOpportunityApplicationSchema.index(
  { jobId: 1, applicantId: 1 },
  { unique: true }
);

export default mongoose.models.DeputyOpportunityApplication ||
  mongoose.model(
    "DeputyOpportunityApplication",
    DeputyOpportunityApplicationSchema
  );