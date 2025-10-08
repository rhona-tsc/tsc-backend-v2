import mongoose from 'mongoose';

const distanceCacheSchema = new mongoose.Schema({
  from: { type: String, required: true }, // origin postcode (normalized to uppercase and no spaces)
  to: { type: String, required: true },   // destination postcode
  distanceKm: Number,
  durationMinutes: Number,
  lastUpdated: { type: Date, default: Date.now },
});


distanceCacheSchema.index({ from: 1, to: 1 }, { unique: true });

// Refresh lastUpdated on every save
distanceCacheSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

export default mongoose.model('travelCache', distanceCacheSchema);