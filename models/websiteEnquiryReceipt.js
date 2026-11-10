import mongoose from "mongoose";
import { marketingAttributionSchema } from './marketingAttributionSchema.js';
const schema = new mongoose.Schema({
  _id: { type: String },
  key: { type: String, required: true, unique: true },
  receiptId: { type: String, required: true, unique: true },
  attribution: { type: marketingAttributionSchema, default: undefined },
}, { timestamps: true });
export default mongoose.model("WebsiteEnquiryReceipt", schema);
