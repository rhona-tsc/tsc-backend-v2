import mongoose from "mongoose";

const keywordSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, trim: true },
    targetUrl: { type: String, default: "", trim: true },
    source: {
      type: String,
      enum: ["search_console", "google_ads", "manual"],
      default: "manual",
    },
    active: { type: Boolean, default: true },
  },
  { _id: true },
);

const trackerSchema = new mongoose.Schema(
  {
    key: { type: String, default: "primary", unique: true },
    propertyUrl: {
      type: String,
      default: "sc-domain:thesupremecollective.co.uk",
      trim: true,
    },
    recipients: {
      type: [String],
      default: ["hello@thesupremecollective.co.uk"],
    },
    enabled: { type: Boolean, default: true },
    sendDay: { type: Number, min: 1, max: 20, default: 4 },
    keywords: { type: [keywordSchema], default: [] },
    lastRunAt: Date,
    lastEmailAt: Date,
    lastError: { type: String, default: "" },
    googleConnected: { type: Boolean, default: false },
    googleConnectedAt: Date,
    googleAccountEmail: { type: String, default: "" },
    googleRefreshTokenEncrypted: { type: String, default: "", select: false },
  },
  { timestamps: true },
);

export default mongoose.models.SeoKeywordTracker ||
  mongoose.model("SeoKeywordTracker", trackerSchema);
