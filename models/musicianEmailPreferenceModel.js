import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  emailHash: { type: String, required: true, unique: true },
  deputyOpportunities: { type: Boolean, default: true },
  originalsOpportunities: { type: Boolean, default: true },
  profileDeletedAt: { type: Date, default: null },
}, { timestamps: true });
export default mongoose.models.musicianemailpreference || mongoose.model('musicianemailpreference', schema);
