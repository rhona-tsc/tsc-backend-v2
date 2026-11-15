import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  bookingKey: { type: String, required: true },
  bookingRef: String, eventDate: String, actName: String,
  reviewerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reviewerName: String, reviewerEmail: String,
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true }, recipientName: String,
  ratings: { type: Map, of: Number }, comment: { type: String, maxlength: 2000 },
  status: { type: String, enum: ['pending', 'reviewed', 'flagged', 'dismissed'], default: 'pending' },
  moderationNote: { type: String, maxlength: 2000 }, moderatedAt: Date, moderatedBy: String,
}, { timestamps: true });
schema.index({ bookingKey: 1, reviewerId: 1, recipientId: 1 }, { unique: true });
export default mongoose.model('PeerReview', schema);
