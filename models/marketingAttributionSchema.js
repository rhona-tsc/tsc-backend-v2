import mongoose from 'mongoose';
const touch = new mongoose.Schema({
  channel: String, source: String, medium: String, capturedAt: Date,
  campaign: String, content: String, keyword: String, campaignId: String, adGroupId: String, adId: String,
  matchType: String, network: String, device: String, landingPath: String, referrerHost: String,
  gclid: String, gbraid: String, wbraid: String,
}, { _id: false });
export const marketingAttributionSchema = new mongoose.Schema({ version: Number, consentGranted: Boolean, firstTouch: touch, lastTouch: touch }, { _id: false });
