import mongoose from "mongoose";

const AutomationConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    rules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    version: { type: Number, default: 0 },
    updatedBy: { type: String, default: "" },
    updateSource: { type: String, default: "" },
  },
  { timestamps: true },
);

const AutomationConfigRevisionSchema = new mongoose.Schema(
  {
    configKey: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    rules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    actor: { type: String, default: "" },
    source: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);

AutomationConfigRevisionSchema.index(
  { configKey: 1, version: 1 },
  { unique: true },
);

export const AutomationConfig =
  mongoose.models.AutomationConfig ||
  mongoose.model("AutomationConfig", AutomationConfigSchema);

export const AutomationConfigRevision =
  mongoose.models.AutomationConfigRevision ||
  mongoose.model("AutomationConfigRevision", AutomationConfigRevisionSchema);

