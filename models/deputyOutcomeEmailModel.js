import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'deputyjob', required: true, index: true },
  musicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', required: true },
  emailHash: { type: String, required: true },
  to: { type: String, required: true }, firstName: String,
  status: { type: String, enum: ['pending', 'sending', 'sent', 'skipped', 'uncertain'], default: 'pending', index: true },
  sendAfter: { type: Date, default: Date.now, index: true },
  claimedAt: Date, sentAt: Date, attempts: { type: Number, default: 0 },
  messageId: String, providerMessageId: String, reason: String,
}, { timestamps: true });
export default mongoose.models.deputyoutcomeemail || mongoose.model('deputyoutcomeemail', schema);
