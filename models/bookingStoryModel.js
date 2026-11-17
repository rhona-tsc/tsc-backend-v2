import mongoose from 'mongoose';

const destination = new mongoose.Schema({
  state: { type: String, default: 'pending' },
  containerId: String, mediaId: String, publishedAt: Date, error: String,
}, { _id: false });
const story = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  bookingRef: String, actId: mongoose.Schema.Types.ObjectId, actName: String,
  eventDateISO: String, sourceVenueAddress: String, venueName: String, venueLocation: String,
  venuePhotoUrl: String, stickerUrl: String, mediaUrl: String,
  status: { type: String, default: 'needs_assets', index: true },
  confirmed: { type: Boolean, default: false },
  approved: { type: Boolean, default: false },
  notBefore: Date, publishedAt: Date, lastError: String,
  platforms: { type: [String], default: ['instagram', 'facebook'] },
  instagram: { type: destination, default: () => ({}) },
  facebook: { type: destination, default: () => ({}) },
}, { timestamps: true });
export const BookingStory = mongoose.models.BookingStory || mongoose.model('BookingStory', story);
export const StorySettings = mongoose.models.StorySettings || mongoose.model('StorySettings', new mongoose.Schema({
  _id: { type: String, default: 'booking-stories' },
  enabled: { type: Boolean, default: false },
  autoApprove: { type: Boolean, default: false },
  hour: { type: Number, default: 12, min: 0, max: 23 },
  minute: { type: Number, default: 0, min: 0, max: 59 },
  accountMusicianId: mongoose.Schema.Types.ObjectId,
  expectedInstagramId: String, expectedPageId: String,
  activationDate: { type: Date, default: Date.now },
}, { timestamps: true }));
export const StoryDay = mongoose.models.StoryDay || mongoose.model('StoryDay', new mongoose.Schema({
  _id: String, storyId: mongoose.Schema.Types.ObjectId, reservedAt: Date,
}));
export const StoryLease = mongoose.models.StoryLease || mongoose.model('StoryLease', new mongoose.Schema({
  _id: String, owner: String, until: Date,
}));
export const ActStoryAsset = mongoose.models.ActStoryAsset || mongoose.model('ActStoryAsset', new mongoose.Schema({
  actId: { type: mongoose.Schema.Types.ObjectId, unique: true, required: true },
  actName: String, stickerUrl: String, transparencyVerified: { type: Boolean, default: false },
}, { timestamps: true }));

export const VenueStoryAsset = mongoose.models.VenueStoryAsset || mongoose.model('VenueStoryAsset', new mongoose.Schema({
  address: { type: String, unique: true, required: true }, venueName: String, venueLocation: String, venuePhotoUrl: String,
}, { timestamps: true }));
