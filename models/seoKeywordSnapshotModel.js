import mongoose from "mongoose";

const rowSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true },
    targetUrl: { type: String, default: "" },
    clicks: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    position: { type: Number, default: null },
    previousClicks: { type: Number, default: 0 },
    previousImpressions: { type: Number, default: 0 },
    previousPosition: { type: Number, default: null },
    positionChange: { type: Number, default: null },
    topPage: { type: String, default: "" },
    status: { type: String, default: "No impressions yet" },
    recommendedAction: { type: String, default: "" },
  },
  { _id: false },
);

const snapshotSchema = new mongoose.Schema(
  {
    propertyUrl: { type: String, required: true },
    periodStart: { type: String, required: true },
    periodEnd: { type: String, required: true },
    comparisonStart: { type: String, required: true },
    comparisonEnd: { type: String, required: true },
    rows: { type: [rowSchema], default: [] },
    emailedAt: Date,
  },
  { timestamps: true },
);

snapshotSchema.index({ propertyUrl: 1, periodStart: 1 }, { unique: true });

export default mongoose.models.SeoKeywordSnapshot ||
  mongoose.model("SeoKeywordSnapshot", snapshotSchema);
