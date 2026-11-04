import mongoose from 'mongoose';
// Append-only evidence: create a new acceptance for every acknowledgement; never update an earlier record.
const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalproject', required: true, immutable: true, index: true },
  musicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', required: true, immutable: true, index: true },
  roleName: { type: String, required: true, immutable: true },
  type: { type: String, enum: ['contributor', 'mix', 'master'], required: true, immutable: true },
  version: { type: String, required: true, immutable: true },
  text: { type: String, required: true, immutable: true },
  textHash: { type: String, required: true, immutable: true },
  fullName: { type: String, required: true, maxlength: 160, immutable: true },
  accepted: { type: Boolean, required: true, immutable: true },
  acceptedAt: { type: Date, required: true, immutable: true },
}, { timestamps: true });
export default mongoose.models.originalagreementacceptance || mongoose.model('originalagreementacceptance', schema);
