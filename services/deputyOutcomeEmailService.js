import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Job from '../models/deputyJobModel.js';
import Musician from '../models/musicianModel.js';
import Email from '../models/deputyOutcomeEmailModel.js';
import sendEmail from '../utils/sendEmail.js';
import { musicianOpportunityAllowed } from './musicianEmailPreferenceService.js';
import { musicianEmailHash, musicianEmailPreferencesUrl } from '../utils/musicianEmailPreferences.js';
import { escapeEmailHtml, buildTscEmailFooter, buildTscEmailFooterText } from '../utils/tscEmailBranding.js';
import { londonDay } from '../utils/bookingAllocationPolicy.js';
const startup = new Date();
const id = value => String(value?._id || value || '');
const email = value => String(value || '').trim().toLowerCase();
const activeApplications = new Set(['applied', 'shortlisted', 'presented']);
export const deputyJobHasAllocation = job => !job?.previewMode && ['allocated', 'filled'].includes(job?.status) && Boolean(job.bookedMusicianId || job.allocatedMusicianId || job.roleAllocations?.some(a => ['allocated', 'booked'].includes(a.status)));
// Allocating directly on the booking board must also close its linked advert.
export async function completeDeputyAdvertForAssignment({ board, assignment, jobs = Job, now = new Date() }) {
  if (!assignment?.deputyJobId || !assignment.musicianId || assignment.withdrawnAt || !['confirmed', 'accepted'].includes(assignment.status)) return null;
  return jobs.findOneAndUpdate({ _id: assignment.deputyJobId, 'automation.bookingBoardItemId': board._id,
    'automation.roleSlotId': assignment.roleSlotId, status: { $in: ['open', 'allocated'] } }, { $set: {
      status: 'filled', workflowStage: 'booking_confirmed', allocatedMusicianId: assignment.musicianId,
      bookedMusicianId: assignment.musicianId, bookedMusicianName: assignment.name,
      allocatedAt: now, bookingConfirmedAt: now, outcomeUpdatesAllocationAt: null,
  } }, { new: true });
}
export function deputyOutcomeRecipients(job) {
  if (!deputyJobHasAllocation(job)) return [];
  const selectedIds = new Set([job.bookedMusicianId, job.allocatedMusicianId,
    ...(job.roleAllocations || []).filter(a => ['allocated', 'booked'].includes(a.status)).map(a => a.musicianId),
    ...(job.applications || []).filter(a => ['allocated', 'booked'].includes(a.status)).map(a => a.musicianId)].filter(Boolean).map(id));
  const selectedEmails = new Set((job.applications || []).filter(a => selectedIds.has(id(a.musicianId))).map(a => email(a.email)).filter(Boolean));
  const seen = new Set();
  return (job.applications || []).filter(a => {
    const to = email(a.email);
    if (!activeApplications.has(a.status) || !a.musicianId || selectedIds.has(id(a.musicianId)) || selectedEmails.has(to)) return false;
    const key = to || id(a.musicianId); if (seen.has(key)) return false; seen.add(key); return true;
  });
}
export function buildDeputyOutcomeEmail({ job, recipient }) {
  const name = recipient.firstName || 'there';
  const date = new Date(`${String(job.eventDate || job.date).slice(0,10)}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const role = job.instrument || 'musician';
  const venue = job.venue || job.location || job.locationName || 'the advertised venue';
  const url = `${musicianEmailPreferencesUrl(recipient.to || recipient.email)}#deputy-filled-updates`;
  const subject = `Gig filled: ${role} — ${date}`;
  const paragraphs = [`Hi ${name},`, `Thank you for putting yourself forward for the ${role} role at ${venue} on ${date}.`, 'The gig has now been filled. We really appreciate your interest and hope to work with you on another opportunity soon.', 'Prefer not to receive these updates? You can switch off “gig filled” emails separately and keep receiving new deputy opportunities.'];
  const text = [...paragraphs, `Manage gig-filled updates: ${url}`, 'Best wishes,\nTSC Assistant', buildTscEmailFooterText()].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#222"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:640px;background:white;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden" cellpadding="0" cellspacing="0"><tr><td style="background:#111;padding:26px 24px;color:white"><p style="font-size:12px;letter-spacing:2px;color:#ff8585;font-weight:bold">THE SUPREME COLLECTIVE</p><h1 style="font-size:27px;margin:12px 0 0">The gig has now been filled</h1></td></tr><tr><td style="padding:28px 24px">${paragraphs.map(p=>`<p style="font-size:16px;line-height:26px;margin:0 0 18px">${escapeEmailHtml(p)}</p>`).join('')}<p style="margin:24px 0"><a href="${escapeEmailHtml(url)}" style="display:inline-block;background:#ff6667;padding:14px 22px;border-radius:8px;color:#111;font-weight:bold;text-decoration:none">Manage these updates</a></p><p style="line-height:25px">Best wishes,<br><strong>TSC Assistant</strong></p>${buildTscEmailFooter({audience:'musician'})}</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
export async function queueDeputyOutcomeEmails({ job, now = new Date(), emails = Email, musicians = Musician, allowed = musicianOpportunityAllowed }) {
  let queued = 0; const seen = new Set();
  for (const application of deputyOutcomeRecipients(job)) {
    const musician = await musicians.findById(application.musicianId).select('_id email firstName profileDeletedAt mergedIntoMusicianId').lean();
    const to = email(musician?.email || application.email);
    if (!musician || musician.profileDeletedAt || musician.mergedIntoMusicianId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || seen.has(to)) continue;
    seen.add(to); if (!await allowed(to, 'deputy_outcome')) continue;
    const emailHash = musicianEmailHash(to), eventKey = `deputy-filled:${job._id}:${emailHash}`;
    try {
      const result = await emails.updateOne({ eventKey }, { $setOnInsert: { eventKey, jobId: job._id, musicianId: musician._id, to, firstName: musician.firstName || application.firstName, emailHash, status: 'pending', sendAfter: now } }, { upsert: true });
      queued += result.upsertedCount || 0;
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  return { queued };
}
export async function deliverDeputyOutcomeEmails({ now = new Date(), limit = 30, jobs = Job, musicians = Musician, emails = Email, features = mongoose.connection.collection('automationfeatures'), allowed = musicianOpportunityAllowed, send = sendEmail } = {}) {
  const feature = await features.findOneAndUpdate({ _id: 'deputy-filled-updates-v1' }, { $setOnInsert: { enabledAt: startup } }, { upsert: true, returnDocument: 'after' });
  const enabledAt = feature.enabledAt || feature.value?.enabledAt;
  if (!enabledAt) throw new Error('Deputy outcome activation time could not be read');
  // Only new allocations after activation; never announce historical outcomes in bulk.
  const recent = await jobs.find({ status: { $in: ['allocated', 'filled'] }, eventDate: { $gte: londonDay(now) }, previewMode: { $ne: true },
    $or: [{ allocatedAt: { $gte: enabledAt } }, { bookingConfirmedAt: { $gte: enabledAt } }],
    $expr: { $ne: ['$outcomeUpdatesAllocationAt', { $max: ['$allocatedAt', '$bookingConfirmedAt'] }] },
  }).sort({ updatedAt: 1 }).limit(200).lean();
  for (const job of recent) {
    await queueDeputyOutcomeEmails({ job, now, emails, musicians, allowed });
    const allocationAt = new Date(Math.max(+new Date(job.allocatedAt || 0), +new Date(job.bookingConfirmedAt || 0)));
    await jobs.updateOne({ _id: job._id }, { $set: { outcomeUpdatesAllocationAt: allocationAt } });
  }
  // A lost receipt may have followed a successful SMTP send: hold for reconciliation.
  await emails.updateMany({ status: 'sending', claimedAt: { $lt: new Date(+now - 15*60000) } }, { $set: { status: 'uncertain', reason: 'Delivery interrupted; reconcile Sent before retrying' } });
  const results = [];
  for (let n=0;n<limit;n++) {
    const row = await emails.findOneAndUpdate({ status: 'pending', sendAfter: { $lte: now } }, { $set: { status: 'sending', claimedAt: now }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
    if (!row) break;
    try {
      const job = await jobs.findById(row.jobId).lean();
      const musician = await musicians.findById(row.musicianId).select('_id email profileDeletedAt mergedIntoMusicianId').lean();
      const stillApplicant = job && deputyOutcomeRecipients(job).some(a => id(a.musicianId) === id(row.musicianId));
      if (!stillApplicant || !musician || musician.profileDeletedAt || musician.mergedIntoMusicianId || email(musician.email) !== row.to || !await allowed(row.to, 'deputy_outcome')) {
        await emails.updateOne({ _id: row._id, status: 'sending' }, { $set: { status: 'skipped', reason: 'Allocation, applicant or email preference changed' } }); results.push('skipped'); continue;
      }
      const messageId = `<deputy-filled-${createHash('sha256').update(row.eventKey).digest('hex')}@thesupremecollective.co.uk>`;
      await emails.updateOne({ _id: row._id }, { $set: { messageId } });
      const message = buildDeputyOutcomeEmail({ job, recipient: row });
      const result = await send({ ...message, to: row.to, messageId, from: 'The Supreme Collective <hello@thesupremecollective.co.uk>', opportunityCategory: 'deputy_outcome' });
      if (result?.skipped) { await emails.updateOne({ _id: row._id }, { $set: { status: 'skipped', reason: result.reason } }); results.push('skipped'); continue; }
      if (!result?.ok) {
        const definitive = ['EAUTH','ECONNECTION','EDNS','EENVELOPE'].includes(result?.code) || [421,450,451,452,535,550,551,552,553,554].includes(result?.responseCode);
        const retry = definitive && row.attempts < 5;
        await emails.updateOne({ _id: row._id }, { $set: { status: retry ? 'pending' : 'uncertain', sendAfter: new Date(+now+15*60000), reason: result?.error || 'No delivery receipt' } });
        results.push(retry ? 'retry' : 'uncertain'); continue;
      }
      await emails.updateOne({ _id: row._id }, { $set: { status: 'sent', sentAt: new Date(), providerMessageId: result.messageId || messageId, reason: '' } });
      await jobs.updateOne({ _id: row.jobId, 'notifications.providerMessageId': { $ne: result.messageId || messageId } }, { $push: { notifications: { musicianId: row.musicianId, email: row.to, channel: 'email', type: 'application_filled', status: 'sent', subject: message.subject, providerMessageId: result.messageId || messageId, sentAt: new Date() } } });
      results.push('sent');
    } catch (error) {
      await emails.updateOne({ _id: row._id, status: 'sending' }, { $set: { status: 'uncertain', reason: error.message } }); results.push('uncertain');
    }
  }
  return { checkedJobs: recent.length, results };
}
