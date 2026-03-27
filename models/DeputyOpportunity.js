import mongoose from "mongoose";

const DeputyOpportunitySchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Musician",
      required: true,
    },
    createdByEmail: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    createdByRole: {
      type: String,
      enum: ["admin", "musician", "agent"],
      default: "musician",
    },

    title: { type: String, required: true, trim: true },
    actName: { type: String, default: "", trim: true },

    dateISO: { type: String, required: true }, // yyyy-mm-dd
    startTime: { type: String, default: "" },  // "18:00"
    endTime: { type: String, default: "" },

    venueName: { type: String, default: "", trim: true },
    formattedAddress: { type: String, default: "", trim: true },
    postcode: { type: String, default: "", trim: true },
    county: { type: String, default: "", trim: true },

    fee: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "GBP" },

    requiredRoles: [{ type: String, trim: true }],
    requiredSkills: [{ type: String, trim: true }],
    styles: [{ type: String, trim: true }],

    requiresBackingVox: { type: Boolean, default: false },
    requiresOwnPA: { type: Boolean, default: false },
    requiresOwnLighting: { type: Boolean, default: false },
    requiresDJGear: { type: Boolean, default: false },
    requiresTransport: { type: Boolean, default: false },

    notes: { type: String, default: "", trim: true },

    visibility: {
      type: String,
      enum: ["public_to_members", "matched_only"],
      default: "public_to_members",
    },

    status: {
      type: String,
      enum: ["draft", "open", "allocated", "closed", "cancelled"],
      default: "open",
      index: true,
    },

    commissionApplies: { type: Boolean, default: true },
    commissionPercent: { type: Number, default: 10 },
    commissionAmount: { type: Number, default: 0 },

    allocatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Musician",
      default: null,
    },
    allocatedApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeputyOpportunityApplication",
      default: null,
    },
    allocatedAt: { type: Date, default: null },
    allocatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Musician",
      default: null,
    },

    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

DeputyOpportunitySchema.index({ status: 1, dateISO: 1 });
DeputyOpportunitySchema.index({ createdBy: 1, createdAt: -1 });

export default mongoose.models.DeputyOpportunity ||
  mongoose.model("DeputyOpportunity", DeputyOpportunitySchema);