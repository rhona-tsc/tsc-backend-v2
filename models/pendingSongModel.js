// backend/models/pendingSongModel.js
import mongoose from 'mongoose';

const pendingSongSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  genre: { type: String },
  year: { type: Number },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.PendingSong || mongoose.model('PendingSong', pendingSongSchema);