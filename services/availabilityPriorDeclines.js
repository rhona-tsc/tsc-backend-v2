import Availability from '../models/availabilityModel.js';
import EnquiryMessage from '../models/EnquiryMessage.js';

const clean = value => String(value || '').trim();
export function availabilityPhone(value) {
  let digits = clean(value).replace(/^whatsapp:/i, '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0\d{10}$/.test(digits)) digits = `44${digits.slice(1)}`;
  return digits ? `+${digits}` : '';
}

// Include legacy phone formatting without matching names or substrings of numbers.
function phonePattern(value) {
  const normalized = availabilityPhone(value).slice(1);
  if (!normalized) return null;
  const variants = [normalized, `00${normalized}`];
  if (normalized.startsWith('44')) variants.push(`0${normalized.slice(2)}`);
  const separated = variants.map(digits => [...digits].join('[\\s().-]*'));
  return new RegExp(`^\\s*(?:whatsapp:)?\\s*\\+?(?:${separated.join('|')})\\s*$`, 'i');
}

export function availabilityPersonMatches(row, person) {
  const earlierId = clean(row.musicianId);
  const targetId = clean(person.musicianId);
  if (earlierId && targetId && earlierId === targetId) return true;
  // Duplicate legacy profiles can have different IDs for the same contact.
  // The exact recipient number still declined; don't contact it again. Names
  // alone never establish identity, and conflicting ownership needs staff review.
  const earlierPhone = availabilityPhone(row.phone);
  return Boolean(earlierPhone && earlierPhone === availabilityPhone(person.phone));
}

const normalizedAddress = value => clean(value).toLowerCase()
  .replace(/\buk\b/g, '').replace(/[,\s]+/g, ' ').trim();
export function sameDeclinedLocation(earlier, current) {
  const a = normalizedAddress(earlier), b = normalizedAddress(current);
  if (!a || !b || /^(?:tbc|unknown|n\/a)$/.test(a)) return false;
  if (a === b) return true;
  const postcode = value => value.match(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/)?.[0]?.replace(/\s/g, '');
  return Boolean(postcode(a) && postcode(a) === postcode(b));
}

// Current semantic replies only. Delivery, calendar declines and synthetic skip
// rows must never become a musician's date-wide NO. A corrected YES on the same
// request is no longer a decline; a YES for a different gig doesn't erase a NO.
export function isExplicitAvailabilityDecline(row, person) {
  const legacyDate = new Date(row.date || NaN);
  const day = row.dateISO || row.meta?.MetaISODate ||
    (Number.isFinite(+legacyDate) ? legacyDate.toISOString().slice(0, 10) : '');
  if (day !== person.dateISO) return false;
  if (!availabilityPersonMatches(row, person) ||
      !['unavailable', 'no'].includes(row.reply)) return false;
  const hasReplyEvidence = Boolean(row.inbound?.sid || row.replyHistory?.some(event =>
    ['yes', 'no', 'unavailable'].includes(event.reply) && event.source !== 'system'));
  const hasLegacyOutbound = Boolean(row.messageSidOut || row.outboundSentAt || row.messageSid);
  if (!hasReplyEvidence && !hasLegacyOutbound) return false;
  return row.reply === 'unavailable' || sameDeclinedLocation(
    row.formattedAddress || row.address || row.meta?.MetaAddress,
    person.formattedAddress,
  );
}

const projection = '_id musicianId phone dateISO date reply repliedAt enquiryId requestId actId lineupId formattedAddress address messageSidOut outboundSentAt messageSid inbound replyHistory meta';

// Deliberately no act, lineup, enquiry, deputy, or v2 filter: a whole-date decline
// follows this person across every enquiry. Database errors propagate and hold
// the send, rather than silently treating an unreadable history as availability.
export async function findPriorAvailabilityDecline(person, models = {}) {
  const { dateISO, musicianId, phone } = person;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) {
    throw new Error('Cannot check prior availability replies without an exact event date');
  }
  const start = new Date(`${dateISO}T00:00:00Z`);
  if (!Number.isFinite(+start) || start.toISOString().slice(0, 10) !== dateISO) {
    throw new Error('Cannot check prior availability replies without a valid event date');
  }
  const identity = [];
  if (/^[a-f\d]{24}$/i.test(clean(musicianId))) identity.push({ musicianId });
  const pattern = phonePattern(phone);
  if (pattern) identity.push({ phone: pattern });
  if (!identity.length) throw new Error('Cannot check prior availability replies without a musician identity');
  const end = new Date(+start + 86_400_000);
  const availability = models.Availability || Availability;
  const bookingRequests = models.EnquiryMessage || EnquiryMessage;
  const [requests, bookings] = await Promise.all([
    availability.find({ reply: { $in: ['unavailable', 'no'] },
      $and: [{ $or: identity }, { $or: [{ dateISO },
        { dateISO: { $in: [null, ''] }, date: { $gte: start, $lt: end } }] }] })
      .select(projection).lean(),
    bookingRequests.find({ reply: { $in: ['unavailable', 'no'] },
      'meta.MetaISODate': dateISO, $or: identity }).select(projection).lean(),
  ]);
  return [...requests, ...bookings].find(row => isExplicitAvailabilityDecline(row, person)) || null;
}

export async function assertNoPriorAvailabilityDecline(person) {
  const prior = await findPriorAvailabilityDecline(person);
  if (prior) throw Object.assign(new Error(
    'This musician already declined this date or location. No new request was sent.'), {
    code: 'AVAILABILITY_PRIOR_DECLINE', priorRequestId: String(prior.requestId || prior.enquiryId || prior._id),
  });
}
