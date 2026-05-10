import mongoose from "mongoose";

const StripeLedgerSyncSchema = new mongoose.Schema(
  {
    payoutId: { type: String, required: true, unique: true, index: true },
    payoutDateISO: { type: String },
    payoutAmount: { type: Number, default: 0 },

    // FreeAgent artefacts
    freeagentJournalSetUrl: { type: String },
    freeagentBankTransactionUrl: { type: String },
    freeagentExplanationUrl: { type: String },

    status: {
      type: String,
      enum: ["synced", "partial", "failed"],
      default: "synced",
    },
    error: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export default mongoose.models.StripeLedgerSync ||
  mongoose.model("StripeLedgerSync", StripeLedgerSyncSchema);