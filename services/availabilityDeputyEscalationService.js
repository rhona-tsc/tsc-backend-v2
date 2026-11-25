import { automatedEnquiryEligible } from '../utils/enquiryAutomationEligibility.js';
import { availabilityReminderQuietHours } from './availabilityReminderService.js';

const THREE_HOURS = 3 * 60 * 60 * 1000;
const reason = 'no-reply-3h';
const identityFields = ['enquiryId', 'actId', 'lineupId', 'dateISO', 'phone', 'slotIndex', 'requestId', 'requestKey', 'messageSidOut', 'fee', 'duties', 'formattedAddress'];
const clean = value => String(value ?? '').trim();

export function deputyEscalationEligibility(row, now = Date.now()) {
  if (!row || row.isDeputy || !automatedEnquiryEligible(row, now)) return 'ineligible-request';
  if (identityFields.some(field => !clean(row[field])) || !Number.isInteger(row.slotIndex)) return 'missing-exact-scope';
  if (row.reply != null || row.repliedAt) return 'lead-already-replied';
  if (row.confirmedBooking || row.availabilityRemindersPausedAt ||
      row.websiteReplies?.some(item => item.senderRole === 'musician') ||
      ['declined', 'cancelled', 'tentative', 'decline_confirmation_pending'].includes(row.calendarStatus) ||
      ['failed', 'undelivered', 'unavailable', 'declined', 'accepted'].includes(row.status) ||
      ['failed', 'undelivered', 'canceled'].includes(row.deliveryStatus)) return 'request-held';
  const sent = new Date(row.outboundSentAt || 0).getTime();
  if (!(sent > 0) || sent > now) return 'original-send-not-recorded';
  // Magnolia's northern lead/deputy costs require an individual price review.
  if (clean(row.actId) === '695e637a10134e7eba1993e8') return 'magnolia-deputy-fee-review-required';
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean(row.fee)) || !(Number(row.fee) > 0)) return 'original-fee-unconfirmed';
  return null;
}

export function deputyEscalationMatches(job, row) {
  return Boolean(row && clean(job.availabilityId) === clean(row._id) &&
    identityFields.every(field => clean(job[field]) === clean(row[field])) &&
    +new Date(job.outboundSentAt) === +new Date(row.outboundSentAt));
}

// Dependencies are injected: all tests exercise the real queue decisions without
// connecting to MongoDB, WhatsApp, calendars or any musician.
export function createDeputyEscalationService({
  Availability, Deferred, getScopeState, getOriginalDelivery, notifyDeputies,
  logger = console,
}) {
  const finish = (job, error) => Deferred.updateOne({ _id: job._id, status: 'processing' }, {
    $set: { status: 'processed', processedAt: new Date(), error: error || '' },
  });

  async function schedule({ availabilityId, now = Date.now() } = {}) {
    if (!availabilityId) return { scheduled: false, reason: 'missing-availability-id' };
    const row = await Availability.findById(availabilityId).lean();
    const held = deputyEscalationEligibility(row, now);
    if (held) return { scheduled: false, reason: held };
    // A request's clock starts at its actual send, never at an upsert/retry.
    const dueAt = new Date(+new Date(row.outboundSentAt) + THREE_HOURS);
    const previous = await Deferred.findOne({ availabilityId: row._id, reason }).lean();
    const key = previous?._id || row._id;
    const snapshot = Object.fromEntries(identityFields.map(field => [field, row[field]]));
    try {
      const job = await Deferred.findOneAndUpdate({ _id: key }, {
        $setOnInsert: { ...snapshot, availabilityId: row._id, reason,
          outboundSentAt: row.outboundSentAt, dueAt, status: 'pending',
          formattedAddress: row.formattedAddress, clientName: row.clientName || '',
          clientEmail: row.clientEmail || '' },
      }, { upsert: true, new: true });
      return { scheduled: job.status === 'pending', id: job._id, dueAt: job.dueAt, status: job.status };
    } catch (error) {
      // The existing _id index makes simultaneous schedulers idempotent.
      if (error?.code !== 11000) throw error;
      return { scheduled: false, reason: 'already-scheduled' };
    }
  }

  async function cancel({ availabilityId, enquiryId, actId, lineupId, dateISO, phone, slotIndex } = {}) {
    const scope = availabilityId ? { availabilityId } :
      enquiryId && actId && lineupId && dateISO && phone && Number.isInteger(slotIndex)
        ? { enquiryId, actId, lineupId, dateISO, phone, slotIndex } : null;
    if (!scope) return { modifiedCount: 0 };
    return Deferred.updateMany({ ...scope, reason, status: { $in: ['pending', 'processing'] } }, {
      $set: { status: 'cancelled', processedAt: new Date() },
    });
  }

  async function evaluate(job, now) {
    if (!job.availabilityId) return { held: 'missing-original-request' };
    const row = await Availability.findById(job.availabilityId).lean();
    if (!deputyEscalationMatches(job, row)) return { held: 'original-request-changed' };
    const held = deputyEscalationEligibility(row, now);
    if (held) return { held };
    if (+new Date(row.outboundSentAt) + THREE_HOURS > now) return { held: 'not-due' };
    const state = await getScopeState(row);
    if (!state?.active) return { held: state?.reason || 'inactive-enquiry' };
    const deputies = await Availability.exists({
      enquiryId: row.enquiryId, actId: row.actId, lineupId: row.lineupId,
      dateISO: row.dateISO, slotIndex: row.slotIndex, isDeputy: true,
      messageSidOut: { $exists: true, $nin: [null, ''] },
    });
    if (deputies) return { held: 'already-escalated' };
    const delivery = await getOriginalDelivery(row);
    if (!['delivered', 'read'].includes(delivery?.status)) return { held: 'original-not-delivered' };
    return { row };
  }

  async function processDue({ maxBatch = 20, now = Date.now(), dryRun = false } = {}) {
    const result = { processed: [], skipped: [], failed: [], eligible: [] };
    if (availabilityReminderQuietHours(now)) return result;
    const due = { reason, status: 'pending', dueAt: { $lte: new Date(now) } };
    if (dryRun) {
      const jobs = await Deferred.find(due).sort({ dueAt: 1 }).limit(maxBatch).lean();
      for (const job of jobs) {
        const check = await evaluate(job, now);
        (check.held ? result.skipped : result.eligible).push({ id: String(job._id), reason: check.held });
      }
      return result;
    }
    for (let count = 0; count < maxBatch; count++) {
      const job = await Deferred.findOneAndUpdate(due, {
        $set: { status: 'processing', processingStartedAt: new Date(now) },
      }, { sort: { dueAt: 1 }, new: true });
      if (!job) break;
      try {
        const check = await evaluate(job, now);
        if (check.held) {
          await finish(job, check.held);
          result.skipped.push({ id: String(job._id), reason: check.held });
          continue;
        }
        // A reply/closure can arrive while delivery is checked: recheck directly
        // before dispatch. notifyDeputies/recipient reservation also deduplicate.
        const fresh = await Availability.findById(job.availabilityId).lean();
        const state = await getScopeState(fresh);
        if (!deputyEscalationMatches(job, fresh) || deputyEscalationEligibility(fresh, now) || !state?.active) {
          await finish(job, 'reply-or-state-changed-before-send');
          result.skipped.push({ id: String(job._id), reason: 'reply-or-state-changed-before-send' });
          continue;
        }
        const outcome = await notifyDeputies({
          actId: fresh.actId, lineupId: fresh.lineupId, dateISO: fresh.dateISO,
          enquiryId: fresh.enquiryId, formattedAddress: fresh.formattedAddress,
          clientName: fresh.clientName || '', clientEmail: fresh.clientEmail || '',
          slotIndex: fresh.slotIndex, skipDuplicateCheck: false,
          leadAvailabilityId: fresh._id, inheritLeadOffer: true,
        });
        await finish(job);
        result.processed.push({ id: String(job._id), requestId: fresh.requestId, sent: outcome?.sent || 0 });
      } catch (error) {
        // An exception may follow a partial send. Preserve the claim for review;
        // never replay a possibly accepted batch automatically.
        await Deferred.updateOne({ _id: job._id, status: 'processing' }, {
          $set: { status: 'error', processedAt: new Date(now), error: String(error.message || error) },
        });
        result.failed.push({ id: String(job._id), error: String(error.message || error) });
        logger.error('Deputy handoff held for review', { availabilityId: String(job.availabilityId), error: error.message });
      }
    }
    return result;
  }
  return { schedule, cancel, processDue };
}
