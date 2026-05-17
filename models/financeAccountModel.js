import mongoose from "mongoose";

const financeAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    entity: {
      type: String,
      enum: ["TSC", "BMM", "HSBC", "Monzo Joint",  "Monzo Personal", "AMEX", "CBS", "HL Investment", "HSBC Investment","Bitcoin", "Solana","Ethereum", "True Potential Penson", "Aviva Pension"],
      required: true,
    },

    accountType: {
      type: String,
      enum: ["bank", "savings", "credit_card", "investment", "crypto", "cash"],
      default: "bank",
    },

    provider: { type: String, trim: true },
    lastFour: { type: String, trim: true },

    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    balanceAsOf: Date,

    currency: { type: String, default: "GBP" },

    isActive: { type: Boolean, default: true },
    notes: String,
  },
  { timestamps: true },
);

financeAccountSchema.index({ entity: 1 });
financeAccountSchema.index({ isActive: 1 });

const FinanceAccount =
  mongoose.models.FinanceAccount ||
  mongoose.model("FinanceAccount", financeAccountSchema);

export default FinanceAccount;