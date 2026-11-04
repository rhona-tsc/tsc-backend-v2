import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalproject', required: true, index: true },
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', required: true, index: true },
  referrerName: { type: String, required: true },
  roleName: { type: String, required: true, maxlength: 100 },
  fullName: { type: String, required: true, maxlength: 160 },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, default: '', maxlength: 40 },
  musicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', default: null, index: true },
  claimedAt: { type: Date, default: null },
  tokenHash: { type: String, default: '' },
  expiresAt: { type: Date, required: true },
  emailState: { type: String, enum: ['queued','sending','sent','failed','cancelled'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  sendAfter: { type: Date, default: Date.now },
  leaseExpiresAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });
schema.index({ projectId: 1, email: 1, roleName: 1 }, { unique: true });
export default mongoose.models.originalreferral || mongoose.model('originalreferral', schema);
