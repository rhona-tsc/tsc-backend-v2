import mongoose from "mongoose";
const schema = new mongoose.Schema({
  _id: { type: String },
  key: { type: String, required: true, unique: true },
  receiptId: { type: String, required: true, unique: true },
}, { timestamps: true });
export default mongoose.model("WebsiteEnquiryReceipt", schema);
