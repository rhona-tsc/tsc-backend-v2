import mongoose from "mongoose";

const recurringForecastRuleSchema = new mongoose.Schema(
  {
    entity: {
      type: String,
      enum: ["TSC", "BMM", "Personal", "Savings", "Investment", "Crypto"],
      required: true,
    },

    title: { type: String, required: true, trim: true },
    description: String,

    type: {
      type: String,
      enum: [
        "salary_out",
        "ni_out",
        "vat_out",
        "corporation_tax_out",
        "recurring_income",
        "recurring_expense",
        "manual_adjustment",
      ],
      default: "recurring_expense",
    },

    amount: { type: Number, required: true },
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },

    frequency: {
      type: String,
      enum: ["weekly", "monthly", "quarterly", "yearly"],
      default: "monthly",
    },

    startDate: { type: Date, required: true },
    endDate: Date,

    dayOfMonth: Number, // useful for salary/tax on 31st etc.
    monthOfYear: Number, // useful for yearly rules

    status: {
      type: String,
      enum: ["active", "paused", "ended"],
      default: "active",
    },

    source: { type: String, default: "recurring_rule" },
    notes: String,
  },
  { timestamps: true },
);

recurringForecastRuleSchema.index({ entity: 1 });
recurringForecastRuleSchema.index({ status: 1 });
recurringForecastRuleSchema.index({ startDate: 1 });

const RecurringForecastRule =
  mongoose.models.RecurringForecastRule ||
  mongoose.model("RecurringForecastRule", recurringForecastRuleSchema);

export default RecurringForecastRule;