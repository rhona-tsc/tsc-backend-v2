import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import musicianAuth from '../middleware/musicianAuth.js';
import { BookingStory, ActStoryAsset, VenueStoryAsset } from '../models/bookingStoryModel.js';
import Board from '../models/bookingBoardItem.js';
import Musician from '../models/musicianModel.js';
import cloudinary from '../config/cloudinary.js';
import { settingsForStories, enqueueBookingStory, reconcileBookingStories, runBookingStoryQueue } from '../services/bookingStoryQueue.js';
import { publisherConnection } from '../services/bookingStoryPublisher.js';
import { renderBookingStory } from '../services/bookingStoryRenderer.js';
import { managedStoryUrl } from '../utils/bookingStoryPolicy.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
router.use(musicianAuth, (req, res, next) => {
  if (!['admin', 'superadmin', 'tsc_admin'].includes(String(req.user?.role).toLowerCase()) && req.user?.email !== 'hello@thesupremecollective.co.uk') return res.status(403).json({ message: 'Admin only' });
  next();
});
const action = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ message: e.message }); } };
router.get('/', action(async (_req, res) => {
  const settings = await settingsForStories();
  res.json({ settings, connection: await publisherConnection(settings), jobs: await BookingStory.find().sort({ createdAt: 1 }).limit(500).lean(), assets: await ActStoryAsset.find().lean() });
}));
router.patch('/settings', action(async (req, res) => {
  const s = await settingsForStories();
  if (req.body.autoApprove !== undefined) s.autoApprove = req.body.autoApprove === true;
  if (req.body.enabled !== undefined) s.enabled = req.body.enabled === true;
  for (const field of ['hour', 'minute']) if (req.body[field] !== undefined) s[field] = Number(req.body[field]);
  if (req.body.useMyConnection) {
    const musician = await Musician.findById(req.userId).select('socialConnections.meta').lean();
    const c = musician?.socialConnections?.meta;
    if (!c?.accountId || !c?.pageId) throw new Error('Connect the TSC Meta account first.');
    s.accountMusicianId = req.userId; s.expectedInstagramId = c.accountId; s.expectedPageId = c.pageId;
  }
  await s.save(); res.json({ settings: s, connection: await publisherConnection(s) });
}));
router.post('/sync', action(async (_req, res) => { await reconcileBookingStories(); res.json({ success: true }); }));
router.post('/booking/:id', action(async (req, res) => {
  const row = await Board.findById(req.params.id).lean(); if (!row) throw new Error('Booking not found');
  res.json({ job: await enqueueBookingStory(row) });
}));
router.post('/assets', upload.single('file'), action(async (req, res) => {
  if (!req.file) throw new Error('Choose a file');
  const isImage = /^image\/(jpeg|png|webp)$/.test(req.file.mimetype);
  const isVideo = /^video\//.test(req.file.mimetype);
  const isAudio = /^audio\//.test(req.file.mimetype);
  if (!isImage && !isVideo && !isAudio) throw new Error('Use a photo, video or audio asset');
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'tsc/booking-story-assets', resource_type: isImage ? 'image' : 'video' }, (e, r) => e ? reject(e) : resolve(r));
    stream.end(req.file.buffer);
  });
  res.json({ url: result.secure_url });
}));
router.put('/act/:id/sticker', action(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !managedStoryUrl(req.body.stickerUrl)) throw new Error('Choose an act and upload its sticker');
  const asset = await ActStoryAsset.findOneAndUpdate({ actId: req.params.id }, { $set: {
    actName: String(req.body.actName || ''), stickerUrl: req.body.stickerUrl, transparencyVerified: req.body.transparencyVerified === true,
  } }, { upsert: true, new: true }); res.json({ asset });
}));
router.put('/act/:id/music', action(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !managedStoryUrl(req.body.musicUrl) || !String(req.body.musicTitle || '').trim()) throw new Error('Upload a recording and enter the song title');
  if (req.body.musicCleared !== true) throw new Error('Confirm this recording can be used in the act’s stories');
  const musicStart = Number(req.body.musicStart || 0);
  if (!Number.isFinite(musicStart) || musicStart < 0) throw new Error('Choose a valid clip start');
  const asset = await ActStoryAsset.findOneAndUpdate({ actId: req.params.id }, { $set: { actName: String(req.body.actName || ''), musicUrl: req.body.musicUrl, musicTitle: String(req.body.musicTitle).trim(), musicStart, musicCleared: true } }, { upsert: true, new: true });
  await BookingStory.updateMany({actId:req.params.id,status:{$in:['needs_assets','needs_review','queued']}},{$set:{mediaUrl:'',approved:false,status:'needs_assets'}});
  res.json({asset});
}));
router.patch('/:id', action(async (req, res) => {
  const job = await BookingStory.findById(req.params.id); if (!job) throw new Error('Story not found');
  if (['rendering', 'processing', 'published', 'needs_check'].includes(job.status)) throw new Error('This story is locked because publication has started.');
  for (const key of ['venueName', 'venueLocation', 'venuePhotoUrl', 'mediaUrl']) {
    if (req.body[key] !== undefined) {
      if (key.endsWith('Url') && req.body[key] && !managedStoryUrl(req.body[key])) throw new Error('Use an uploaded story asset');
      job[key] = String(req.body[key]); job.approved = false;
    }
  }
  if (req.body.platforms) {
    if (!Array.isArray(req.body.platforms) || !req.body.platforms.length || req.body.platforms.some(p => !['instagram', 'facebook'].includes(p))) throw new Error('Choose Instagram and/or Facebook');
    job.platforms = [...new Set(req.body.platforms)]; job.approved = false;
  }
  if (req.body.notBefore !== undefined) job.notBefore = req.body.notBefore ? new Date(req.body.notBefore) : null;
  if (req.body.holdForReview !== undefined) job.holdForReview = req.body.holdForReview === true;
  if (req.body.approved !== undefined) { job.approved = req.body.approved === true; if (job.approved) job.holdForReview = false; }
  job.status = req.body.skip ? 'skipped' : !job.confirmed ? 'awaiting_confirmation' : job.mediaUrl && job.approved ? 'queued' : 'needs_assets';
  await job.save();
  const row = await Board.findById(job.bookingId).select('address').lean();
  if (row?.address && job.venueName && job.venuePhotoUrl) await VenueStoryAsset.findOneAndUpdate({ address: row.address.trim().toLowerCase() }, { $set: { venueName: job.venueName, venueLocation: job.venueLocation, venuePhotoUrl: job.venuePhotoUrl } }, { upsert: true });
  res.json({ job });
}));
// Prepare an alternative preview without changing the publication audit.
router.post('/:id/preview', action(async (req, res) => {
  const job = await BookingStory.findById(req.params.id).lean();
  if (!job) throw new Error('Story not found');
  const asset = await ActStoryAsset.findOne({ actId: job.actId, transparencyVerified: true });
  if (!asset) throw new Error('Save a verified transparent act sticker first');
  if (!asset.musicCleared) throw new Error('Save the act’s story music first');
  res.json({ mediaUrl: await renderBookingStory({ ...job, stickerUrl: asset.stickerUrl, musicUrl: asset.musicUrl, musicTitle: asset.musicTitle, musicStart: asset.musicStart }) });
}));
router.post('/:id/render', action(async (req, res) => {
  const job = await BookingStory.findById(req.params.id); if (!job) throw new Error('Story not found');
  if (['rendering', 'processing', 'published', 'needs_check'].includes(job.status)) throw new Error('Publication has already started');
  const asset = await ActStoryAsset.findOne({ actId: job.actId });
  if (!asset?.transparencyVerified) throw new Error('Save a verified transparent act sticker first');
  if (!asset.musicCleared || !asset.musicUrl) throw new Error('Save the act’s story music first');
  const claim = await BookingStory.findOneAndUpdate({ _id: job._id, status: job.status }, { $set: { status: 'rendering' } }, { new: true });
  if (!claim) throw new Error('This story is already being prepared');
  try { claim.stickerUrl = asset.stickerUrl; Object.assign(claim, {musicUrl:asset.musicUrl,musicTitle:asset.musicTitle,musicStart:asset.musicStart}); claim.mediaUrl = await renderBookingStory(claim); claim.approved = false; claim.status = 'needs_review'; claim.lastError = ''; await claim.save(); res.json({ job: claim }); }
  catch (e) { claim.status = 'needs_assets'; claim.lastError = e.message; await claim.save(); throw e; }
}));
router.post('/:id/publish', action(async (req, res) => {
  res.json(await runBookingStoryQueue({ manualStoryId: req.params.id }));
}));
export default router;
