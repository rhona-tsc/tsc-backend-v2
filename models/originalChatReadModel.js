import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'originalproject', required: true },
  musicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'musician', required: true },
  // Fixed-width UTC timestamp + ObjectId gives one atomically comparable cursor.
  readThroughKey: { type: String, required: true },
}, { timestamps: true });
schema.index({ projectId: 1, musicianId: 1 }, { unique: true });
export default mongoose.models.originalchatread || mongoose.model('originalchatread', schema);
