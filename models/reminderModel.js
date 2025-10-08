// backend/models/reminderModel.js
import mongoose from "mongoose";

const ReminderSchema = new mongoose.Schema(
  {
    bookingId: { type: String, index: true, required: true },
    whenISO: { type: Date, index: true, required: true },
    kind: { type: String, enum: ["7d", "3d", "due", "overdue+1d", "custom"], default: "custom" },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["queued", "processing", "done", "failed"], default: "queued", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
  },
  { timestamps: true }
);

ReminderSchema.index({ whenISO: 1, status: 1 });

const Reminder = mongoose.models.Reminder || mongoose.model("Reminder", ReminderSchema);
export default Reminder;