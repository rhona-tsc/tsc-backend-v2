import mongoose from "mongoose";

const requestedRoleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 0 },
    foundationEligible: { type: Boolean, default: false },
  },
  { _id: false },
);

const moderationSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["not_submitted", "pending", "approved", "changes_requested", "rejected"],
      default: "not_submitted",
    },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "musician", default: null },
    reason: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const ownerAgreementSchema = new mongoose.Schema(
  {
    version: { type: String, default: "", trim: true },
    accepted: { type: Boolean, default: false },
    acceptedAt: { type: Date, default: null },
    displayName: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const originalProjectSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "musician",
      required: true,
      index: true,
    },
    ownerName: { type: String, default: "", trim: true },
    ownerEmail: { type: String, default: "", trim: true, lowercase: true },
    ownerAnonymous: { type: Boolean, default: false },
    ownerCreditName: { type: String, default: "", trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    genres: { type: [String], default: [] },
    requestedRoles: { type: [requestedRoleSchema], default: [] },
    hasInitialStem: { type: Boolean, default: false },
    sourceType: {
      type: String,
      enum: ["none", "final_eligible_stem", "guide_track", "video_demo"],
      default: "none",
    },
    ownerSongwritingClaim: { type: Boolean, default: false },
    initialAssetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "originalasset" }],
    bpm: { type: Number, default: null, min: 1, max: 400 },
    musicalKey: { type: String, default: "", trim: true },
    timeSignature: { type: String, default: "", trim: true },
    originalWorkConfirmed: { type: Boolean, default: false },
    state: {
      type: String,
      enum: [
        "draft",
        "pending_moderation",
        "changes_requested",
        "live",
        "foundation_open",
        "role_round_open",
        "owner_review",
        "arrangement_locked",
        "mix_open",
        "mix_review",
        "master_open",
        "master_review",
        "credits_confirmation",
        "approved_master",
        "admin_intervention",
        "paused",
        "cancelled",
        "archived",
      ],
      default: "draft",
      index: true,
    },
    moderation: { type: moderationSchema, default: () => ({}) },
    ownerAgreement: { type: ownerAgreementSchema, default: () => ({}) },
    publishedAt: { type: Date, default: null },
    currentRoundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "originalround",
      default: null,
    },
    currentCreditVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "originalcreditversion", default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

originalProjectSchema.index({ state: 1, publishedAt: -1, createdAt: -1 });
originalProjectSchema.index({ "moderation.status": 1, createdAt: 1 });

const originalProjectModel =
  mongoose.models.originalproject ||
  mongoose.model("originalproject", originalProjectSchema);

export default originalProjectModel;
