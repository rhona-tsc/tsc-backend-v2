import mongoose from "mongoose";

const sampleSchema = new mongoose.Schema({
  platform: String, prompt: String, checkedAt: Date,
  status: { type: String, enum: ["observed", "no_overview", "unavailable"] },
  mentioned: { type: Boolean, default: null },
  cited: { type: Boolean, default: null },
  citationStatus: String,
  citations: [{ _id: false, title: String, url: String }],
  excerpt: String, model: String, error: String,
  artistMentions: { type: [String], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  propertyUrl: { type: String, required: true },
  reportPeriodStart: { type: String, required: true },
  watchlistHash: { type: String, required: true },
  provider: { type: String, default: "searchapi" },
  country: { type: String, default: "GB" },
  language: { type: String, default: "en" },
  status: { type: String, enum: ["collecting", "complete"], default: "collecting" },
  samples: { type: [sampleSchema], default: [] },
  completedAt: Date,
}, { timestamps: true });
// A report refresh or overlapping scheduler must not purchase the same checks again.
schema.index({ propertyUrl: 1, reportPeriodStart: 1, watchlistHash: 1 }, { unique: true });
export default mongoose.models.SeoAiSnapshot || mongoose.model("SeoAiSnapshot", schema);
