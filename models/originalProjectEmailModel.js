import mongoose from 'mongoose';

// Separate from participant notifications: moderation mail goes to the TSC inbox,
// even when that address does not have a musician account.
const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalproject', required: true },
  eventKey: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['moderation', 'launch', 'submission'], required: true },
  submissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalsubmission', default: null },
  revision: { type: Number, default: null },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', default: null },
  submittedAt: { type: Date, default: null },
  to: { type: String, required: true },
  subject: { type: String, required: true },
  text: { type: String, required: true },
  html: { type: String, required: true },
  state: { type: String, enum: ['queued', 'sending', 'sent', 'failed', 'cancelled'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  sendAfter: { type: Date, default: Date.now },
  leaseToken: { type: String, default: '' },
  leaseExpiresAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });
schema.index({ state: 1, sendAfter: 1, leaseExpiresAt: 1 });
export default mongoose.models.originalprojectemail || mongoose.model('originalprojectemail', schema);
