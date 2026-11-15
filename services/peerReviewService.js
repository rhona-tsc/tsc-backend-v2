import mongoose from 'mongoose';
import PeerReview from '../models/peerReviewModel.js';
import sendEmail from '../utils/sendEmail.js';
import { buildTscEmailFooter, escapeEmailHtml as escape } from '../utils/tscEmailBranding.js';

export const categories = ['Performance', 'Preparation', 'Punctuality', 'Teamwork', 'Stage professionalism'];
// Start with new gigs; rollout must not email everybody about historical gigs.
export const launchDate = '2026-11-15';
export const londonParts = (now = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
const keyOf = b => String(b.bookingRef || b.bookingId || b._id);
const active = m => ['accepted', 'confirmed', 'completed'].includes(String(m.status || '').toLowerCase()) && !m.withdrawnAt;
export function finalRoster(b) {
  const members = b.assignedMusicians?.length ? b.assignedMusicians : b.bookingDetails?.assignedMusicians?.length ? b.bookingDetails.assignedMusicians : b.bookingMusicians?.length ? b.bookingMusicians : b.bandLineup || [];
  return [...new Map(members.filter(active).filter(m => mongoose.isValidObjectId(m.musicianId)).map(m => [String(m.musicianId), { id: String(m.musicianId), name: m.name || [m.firstName, m.lastName].filter(Boolean).join(' '), email: String(m.email || '').toLowerCase() }])).values()];
}
export async function reviewBookings(now = new Date()) {
  const p = londonParts(now); const today = `${p.year}-${p.month}-${p.day}`;
  const db = mongoose.connection;
  const board = await db.collection('bookingboarditems').find({ eventDateISO: { $gte: launchDate, $lt: today } }).toArray();
  const core = await db.collection('bookings').find({ $or: [{ eventDateISO: { $gte: launchDate, $lt: today } }, { date: { $gte: launchDate, $lt: today } }, { eventDate: { $gte: new Date(`${launchDate}T00:00:00Z`), $lt: new Date(`${today}T00:00:00Z`) } }] }).toArray();
  const merged = new Map();
  for (const b of core) {
    const linked = board.find(row => String(row.bookingId || row.sourceBookingId || '') === String(b._id) || (row.bookingRef && row.bookingRef === b.bookingRef));
    merged.set(linked ? keyOf(linked) : keyOf(b), b);
  }
  for (const b of board) merged.set(keyOf(b), b);
  return [...merged.values()].filter(b => !['cancelled', 'provisional', 'enquiry', 'declined'].includes(String(b.bookingStatus || b.status || '').toLowerCase())).map(b => ({ key: keyOf(b), ref: b.bookingRef || '', date: String(b.eventDateISO || b.date || b.eventDate?.toISOString?.() || '').slice(0, 10), act: b.actTscName || b.actName || b.actsSummary?.[0]?.actName || 'Your gig', roster: finalRoster(b) })).filter(b => b.roster.length > 1 && b.date >= launchDate && b.date < today);
}
export async function tasksFor(musicianId) {
  const bookings = (await reviewBookings()).filter(b => b.roster.some(m => m.id === String(musicianId)));
  const submitted = await PeerReview.find({ reviewerId: musicianId }).select('bookingKey recipientId').lean();
  return bookings.map(b => ({ bookingKey: b.key, bookingRef: b.ref, eventDate: b.date, actName: b.act, peers: b.roster.filter(m => m.id !== String(musicianId)).map(m => ({ id: m.id, name: m.name, submitted: submitted.some(r => r.bookingKey === b.key && String(r.recipientId) === m.id) })) }));
}
export function validateReview(body) {
  const ratings = {};
  for (const label of categories) { const value = body.ratings?.[label]; if (value == null || value === '') continue; if (!Number.isInteger(value) || value < 1 || value > 5) throw Error('Choose a rating from 1 to 5 or Not observed.'); ratings[label] = value; }
  const comment = String(body.comment || '').trim();
  if (!Object.keys(ratings).length && !comment) throw Error('Add at least one rating or a comment.');
  if (comment.length > 2000) throw Error('Please keep your comment within 2,000 characters.');
  return { ratings, comment };
}
export const reviewEmail = ({ name, act, date, announcement = false }) => {
  const link = 'https://admin.thesupremecollective.co.uk/musicians-dashboard#peer-feedback';
  const subject = announcement ? 'New: private feedback after your TSC gigs' : `How was your gig? ${act} — ${date}`;
  const message = announcement ? 'You can now share feedback about your bandmates after a TSC gig. Look for “Review your bandmates” on your musician dashboard. From today’s gigs onwards, we’ll email you around midday the following day with a link.' : `Thank you for performing with ${act} on ${date}. Please take a moment to share feedback about the musicians you played with.`;
  const privacy = 'Your feedback is private to TSC for review. Other musicians cannot see your comments, ratings or identity, and nothing appears on public profiles. TSC can identify submissions to investigate concerns. Participation is optional.';
  return { subject, text: `Hi ${name || 'there'},\n\n${message}\n\n${privacy}\n\nProvide feedback: ${link}\n\nWarmest wishes,\nThe Supreme Collective`, html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto"><div style="padding:28px;background:#111;color:white;border-radius:20px"><p>The Supreme Collective</p><h1>${announcement ? 'Your voice matters' : 'How was your gig?'}</h1></div><div style="padding:24px"><p>Hi ${escape(name || 'there')},</p><p>${escape(message)}</p><p>${privacy}</p><p><a href="${link}" style="display:inline-block;background:#ff6667;color:white;padding:14px 24px;border-radius:24px;text-decoration:none">${announcement ? 'Open my dashboard' : 'Provide feedback'}</a></p><p>Button not working? <a href="${link}">Open your musician dashboard</a>.</p><p>Warmest wishes,<br>The Supreme Collective</p>${buildTscEmailFooter({ audience: 'musician' })}</div></div>` };
};
// A delivery ledger prevents duplicate sends across workers. Uncertain SMTP
// outcomes remain held for staff investigation, rather than automatic resends.
export async function deliverReviewEmail(key, to, message) {
  const ledger = mongoose.connection.collection('peerreviewdeliveries');
  try { await ledger.insertOne({ _id: key, to, state: 'sending', attemptedAt: new Date() }); } catch (e) { if (e.code === 11000) return false; throw e; }
  const result = await sendEmail({ to, ...message });
  await ledger.updateOne({ _id: key }, { $set: { state: result.ok ? 'sent' : 'failed', messageId: result.messageId || '', error: result.error || '', completedAt: new Date() } });
  return result.ok;
}
let running = false;
export async function sendPeerReviewInvitations(now = new Date()) {
  if (running || mongoose.connection.readyState !== 1) return;
  const p = londonParts(now); if (Number(p.hour) < 12) return;
  running = true;
  try {
    const today = `${p.year}-${p.month}-${p.day}`;
    const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    for (const b of (await reviewBookings(now)).filter(b => b.date === yesterday.toISOString().slice(0, 10))) {
      for (const m of b.roster) {
        const done = await PeerReview.countDocuments({ bookingKey: b.key, reviewerId: m.id });
        if (done >= b.roster.length - 1 || !m.email) continue;
        await deliverReviewEmail(`gig:${b.key}:${m.id}`, m.email, reviewEmail({ name: m.name, act: b.act, date: b.date }));
      }
    }
  } finally { running = false; }
}
