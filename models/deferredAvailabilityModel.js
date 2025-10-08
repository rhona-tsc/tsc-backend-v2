// models/deferredAvailabilityModel.js
import mongoose from "mongoose";
const schema = new mongoose.Schema({
  phone: { type: String, index: true },      // E.164
  createdAt: { type: Date, default: Date.now, index: true },
  payload: { type: Object, required: true }, // what you'd pass to sendWAOrSMS
  actId: { type: mongoose.Types.ObjectId },
  dateISO: { type: String, index: true },
  duties: String,
  fee: String,
  formattedDate: String,
  formattedAddress: String,
});
export default mongoose.model("DeferredAvailability", schema);