import { DateTime } from 'luxon';

export const STORY_ZONE = 'Europe/London';
export function storyDay(now = new Date()) { return DateTime.fromJSDate(now, { zone: STORY_ZONE }).toISODate(); }
export function storyDue(settings, now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: STORY_ZONE });
  return local.hour * 60 + local.minute >= settings.hour * 60 + settings.minute;
}
export function storyEligible(row, core, now = new Date()) {
  if (!row || row.bookingStatus === 'cancelled' || core?.status === 'cancelled') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.eventDateISO || '') || row.eventDateISO < storyDay(now)) return false;
  // A board row alone is not evidence of a secured booking.
  return core?.status === 'confirmed';
}
export function storyReady(job) {
  return job.confirmed && job.approved && !job.holdForReview && /^https:\/\//.test(job.mediaUrl || '') && job.platforms?.length > 0;
}
export function storyComplete(job) {
  return job.platforms.every(p => job[p]?.state === 'published');
}
export function publicStoryDetails(row) {
  return { actName: row.actTscName || row.actName || '', eventDateISO: row.eventDateISO || '',
    venueName: '', venueLocation: '' };
}
export function managedStoryUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com'
    && u.pathname.startsWith(`/${process.env.REACT_APP_CLOUDINARY_NAME}/`) && !u.username && !u.password; }
  catch { return false; }
}
