import crypto from 'node:crypto';
import { BookingStory, StorySettings, StoryDay, StoryLease } from '../models/bookingStoryModel.js';
import Board from '../models/bookingBoardItem.js';
import Booking from '../models/bookingModel.js';
import { storyDay, storyDue, storyEligible, storyReady, storyComplete, publicStoryDetails } from '../utils/bookingStoryPolicy.js';
import { renderBookingStory } from './bookingStoryRenderer.js';
import { ActStoryAsset, VenueStoryAsset } from '../models/bookingStoryModel.js';
import { publisherConnection, publishStoryDestination } from './bookingStoryPublisher.js';

export async function settingsForStories() {
  return StorySettings.findByIdAndUpdate('booking-stories', { $setOnInsert: { activationDate: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
export async function enqueueBookingStory(row) {
  const core = row.bookingId && await Booking.findById(row.bookingId).select('status').lean();
  const confirmed = storyEligible(row, core);
  const details = publicStoryDetails(row);
  const existing = await BookingStory.findOne({ bookingId: row._id });
  if (existing) {
    if (row.bookingStatus === 'cancelled' || core?.status === 'cancelled' || !confirmed) {
      if (!['published', 'skipped'].includes(existing.status)) { existing.status = 'ineligible'; existing.confirmed = false; await existing.save(); }
    } else if (!['published', 'processing', 'needs_check'].includes(existing.status)) {
      // Date/act changes invalidate the rendered announcement and its approval.
      if (existing.eventDateISO !== row.eventDateISO || String(existing.actId || '') !== String(row.actId || '') || (existing.sourceVenueAddress && existing.sourceVenueAddress !== (row.address || ''))) {
        existing.mediaUrl = ''; existing.approved = false; existing.status = 'needs_assets';
        if (existing.sourceVenueAddress !== (row.address || '')) { existing.venueName = ''; existing.venueLocation = ''; existing.venuePhotoUrl = ''; }
      }
      if (['awaiting_confirmation', 'ineligible'].includes(existing.status)) existing.status = 'needs_assets';
      Object.assign(existing, { sourceVenueAddress: row.address || '', actName: details.actName, eventDateISO: details.eventDateISO, actId: row.actId, confirmed }); await existing.save();
    }
    return existing;
  }
  try {
    return await BookingStory.create({ bookingId: row._id, bookingRef: row.bookingRef, actId: row.actId,
      ...details, sourceVenueAddress: row.address || '', confirmed, status: confirmed ? 'needs_assets' : 'awaiting_confirmation' });
  } catch (e) { if (e.code === 11000) return BookingStory.findOne({ bookingId: row._id }); throw e; }
}
export async function reconcileBookingStories() {
  const settings = await settingsForStories();
  await BookingStory.updateMany({ status: 'rendering', updatedAt: { $lt: new Date(Date.now() - 15 * 60000) } }, { $set: { status: 'needs_assets', lastError: 'Preview preparation interrupted; ready to retry.' } });
  const rows = await Board.find({ createdAt: { $gte: settings.activationDate } }).sort({ createdAt: 1 }).limit(500).lean();
  for (const row of rows) await enqueueBookingStory(row);
  // Render one waiting story per pass so imports remain quick and memory bounded.
  const waiting = await BookingStory.find({ status: 'needs_assets', confirmed: true, mediaUrl: { $in: ['', null] } }).sort({ createdAt: 1 }).limit(50);
  for (const job of waiting) {
    const row = await Board.findById(job.bookingId).lean();
    const asset = await ActStoryAsset.findOne({ actId: job.actId, transparencyVerified: true });
    const venue = row?.address && await VenueStoryAsset.findOne({ address: row.address.trim().toLowerCase() });
    if (!asset || !asset.musicUrl || !asset.musicCleared || (!job.venuePhotoUrl && !venue)) continue;
    const claimed = await BookingStory.findOneAndUpdate({ _id: job._id, status: 'needs_assets' }, { $set: { status: 'rendering' } }, { new: true });
    if (!claimed) continue;
    try {
      if (venue && !claimed.venuePhotoUrl) Object.assign(claimed, { venueName: venue.venueName, venueLocation: venue.venueLocation, venuePhotoUrl: venue.venuePhotoUrl });
      claimed.stickerUrl = asset.stickerUrl;
      Object.assign(claimed, { musicUrl: asset.musicUrl, musicTitle: asset.musicTitle, musicStart: asset.musicStart });
      claimed.mediaUrl = await renderBookingStory(claimed);
      claimed.approved = settings.autoApprove === true;
      claimed.status = claimed.approved ? 'queued' : 'needs_review'; claimed.lastError = '';
    } catch (e) { claimed.status = 'needs_assets'; claimed.lastError = e.message; }
    await claimed.save(); break;
  }
}
export async function runBookingStoryQueue({ manualStoryId, now = new Date() } = {}) {
  await Promise.all([BookingStory.init(), StoryDay.init(), StoryLease.init()]);
  const owner = crypto.randomUUID();
  await StoryLease.updateOne({ _id: 'publisher' }, { $setOnInsert: { until: new Date(0) } }, { upsert: true }).catch(e => { if (e.code !== 11000) throw e; });
  const lease = await StoryLease.findOneAndUpdate({ _id: 'publisher', until: { $lte: now } },
    { $set: { owner, until: new Date(now.getTime() + 10 * 60000) } }, { new: true });
  if (!lease) return { state: 'busy' };
  try {
    const settings = await settingsForStories();
    if (!manualStoryId && (!settings.enabled || !storyDue(settings, now))) return { state: 'paused_or_not_due' };
    const connection = await publisherConnection(settings, { revealToken: true });
    if (!connection.ready) return { state: 'blocked', reason: connection.reason };
    const today = storyDay(now);
    let slot = await StoryDay.findById(today);
    if (slot && manualStoryId && String(slot.storyId) !== String(manualStoryId)) return { state: 'daily_limit', reason: 'Another booking already owns today’s story slot.' };
    let job = slot ? await BookingStory.findById(slot.storyId) : manualStoryId
      ? await BookingStory.findById(manualStoryId)
      : (await BookingStory.findOne({ status: 'processing' }).sort({ createdAt: 1 })) || await BookingStory.findOne({ status: 'queued', confirmed: true, approved: true, $or: [{ notBefore: null }, { notBefore: { $lte: now } }] }).sort({ createdAt: 1 });
    if (!job) return { state: 'empty' };
    if (['published', 'skipped', 'needs_check', 'ineligible'].includes(job.status)) return { state: job.status };
    const row = await Board.findById(job.bookingId).lean();
    const core = row?.bookingId && await Booking.findById(row.bookingId).select('status').lean();
    if (!storyEligible(row, core, now) || job.eventDateISO !== row.eventDateISO || String(job.actId || '') !== String(row.actId || '') || (job.sourceVenueAddress && job.sourceVenueAddress !== (row.address || ''))) {
      job.status = 'ineligible'; job.approved = false; await job.save(); return { state: 'ineligible' };
    }
    if (!storyReady(job)) return { state: 'not_ready' };
    if (job.notBefore && job.notBefore > now) return { state: 'not_due' };
    if (!slot) {
      try { slot = await StoryDay.create({ _id: today, storyId: job._id, reservedAt: now }); }
      catch (e) { if (e.code === 11000) return { state: 'daily_limit' }; throw e; }
    }
    job.status = 'processing'; await job.save();
    for (const platform of job.platforms) {
      // A previous process may have stopped after provider acceptance but before
      // recording success. Never automatically repeat that final request.
      if (['publishing', 'uploading'].includes(job[platform].state)) {
        job[platform].state = 'needs_check'; job[platform].error = 'Interrupted provider request. Verify in Meta before retrying.'; await job.save();
      } else await publishStoryDestination(job, platform, connection);
    }
    job.status = storyComplete(job) ? 'published' : job.platforms.some(p => job[p].state === 'needs_check') ? 'needs_check' : 'processing';
    if (job.status === 'published') job.publishedAt = now;
    await job.save(); return { state: job.status, storyId: String(job._id) };
  } finally { await StoryLease.updateOne({ _id: 'publisher', owner }, { $set: { until: new Date(0) } }); }
}
