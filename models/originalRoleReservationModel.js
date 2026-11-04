import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalproject', required: true, index: true },
  musicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', required: true, index: true },
  roleName: { type: String, required: true },
    agreementAcceptanceId: { type: mongoose.Schema.Types.ObjectId, ref: "originalagreementacceptance" },
  roleKey: { type: String, required: true },
  seatNumber: { type: Number, min: 1, max: 3, required: true },
  state: { type: String, enum: ['waiting', 'activated', 'released', 'cancelled'], default: 'waiting', index: true },
  anonymous: { type: Boolean, default: false },
  creditName: { type: String, default: '' },
  agreementVersion: { type: String },
  agreementTextHash: { type: String },
  activeReservationId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalreservation', default: null },
}, { timestamps: true });
schema.index({ projectId: 1, roleKey: 1, seatNumber: 1 }, { unique: true, partialFilterExpression: { state: 'waiting' } });
schema.index({ projectId: 1, roleKey: 1, musicianId: 1 }, { unique: true, partialFilterExpression: { state: 'waiting' } });
export default mongoose.models.originalrolereservation || mongoose.model('originalrolereservation', schema);
