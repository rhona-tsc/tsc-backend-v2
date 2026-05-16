import mongoose from "mongoose";

const financeTransactionSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinanceAccount",
      required: true,
    },

    entity: {
      type: String,
      enum: ["TSC", "BMM", "Personal", "Savings", "Investment", "Crypto"],
      required: true,
    },

    bookingForecastId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingForecast",
    },

    date: { type: Date, required: true },
    description: { type: String, trim: true },
    merchant: { type: String, trim: true },

    amount: { type: Number, required: true }, // positive or negative
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },

    category: {
      type: String,
      enum: [
        "client_payment",
        "supplier_payment",
        "salary",
        "tax",
        "software",
        "advertising",
        "travel",
        "bank_fee",
        "transfer",
        "investment",
        "crypto",
        "personal",
        "other",
      ],
      default: "other",
    },

    vatTreatment: {
      type: String,
      enum: ["standard", "zero", "exempt", "outside_scope", "unknown"],
      default: "unknown",
    },

    taxTreatment: {
      type: String,
      enum: ["income", "allowable_expense", "non_allowable", "transfer", "unknown"],
      default: "unknown",
    },

    source: {
      type: String,
      enum: ["manual", "csv", "open_banking", "stripe", "freeagent"],
      default: "manual",
    },

    externalId: { type: String, trim: true },
    notes: String,
    reconciled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

financeTransactionSchema.index({ accountId: 1, date: -1 });
financeTransactionSchema.index({ entity: 1, date: -1 });
financeTransactionSchema.index({ bookingForecastId: 1 });
financeTransactionSchema.index({ externalId: 1, source: 1 });

const FinanceTransaction =
  mongoose.models.FinanceTransaction ||
  mongoose.model("FinanceTransaction", financeTransactionSchema);

export default FinanceTransaction;