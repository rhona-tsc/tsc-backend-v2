// Booking-specific musician notice. Agency identity is deliberately not rendered.
export const CANCELLATION_NOTICE_VERSION = '2026-11-24';
export const WEDISSIMO_CANCELLATION_SUMMARY = [
  'If the client cancels more than 30 days before the event, there is normally no performance cancellation money payable to the band. This includes cancellations after the initial 30-day refund period because the retained deposit covers the booking commission.',
  'If the client cancels within 30 days of the event, the performance fee less booking commission is due, subject to payment being received. Client non-payment or force majeure can still mean no cancellation money is received.',
].join('\n\n');
export const RECEIPTS_SHARE_NOTICE = 'If the client cancels, your cancellation payment is your agreed share of the cancellation money actually received by TSC for the performance, after booking commission. If no cancellation money is received, no cancellation payment is guaranteed. Your agreed share must be confirmed for this booking; this notice does not change any different terms you have already agreed with TSC.';
export const CANCELLATION_WITHDRAWAL_NOTICE = 'If you do not wish to remain on this gig because of these cancellation terms, open Your Gigs using the link below and choose “I’m no longer available” on this booking. You will be asked to confirm before your role is reopened for cover; opening the link does not withdraw you or cancel the client’s booking.';
export const isWedissimoBooking = (booking = {}) => /^wedissimo$/i.test(String(booking.agent || booking.bookingSource || '').trim());
export const normaliseMusicianCancellationPolicy = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cancellation policy must be an object.');
  if (!['existing_terms', 'receipts_share'].includes(value.paymentBasis)) throw new Error('Select a valid cancellation payment basis.');
  const summary = String(value.summary || '').trim();
  if (summary.length > 4000) throw new Error('Cancellation summary must be 4,000 characters or fewer.');
  return { summary, paymentBasis: value.paymentBasis, version: CANCELLATION_NOTICE_VERSION };
};
export const musicianCancellationNotice = (booking = {}) => {
  const saved = booking.musicianCancellationPolicy;
  const isWedissimo = isWedissimoBooking(booking);
  const summary = String(saved?.summary || '').trim() || (isWedissimo ? WEDISSIMO_CANCELLATION_SUMMARY : '');
  if (!summary) return null; // Do not guess unrecorded policies for other agents or older contracts.
  const paymentBasis = String(saved?.summary || '').trim() ? (saved.paymentBasis || 'existing_terms') : (isWedissimo ? 'receipts_share' : 'existing_terms');
  const paymentText = paymentBasis === 'receipts_share' ? RECEIPTS_SHARE_NOTICE : 'Your existing agreed musician cancellation-payment terms remain in place. This notice summarises the client’s cancellation policy and does not replace your musician agreement.';
  const ref = String(booking.bookingRef || booking.bookingId || booking._id || '').trim();
  const withdrawalUrl = `https://admin.thesupremecollective.co.uk/bookings${ref ? `?booking=${encodeURIComponent(ref)}` : ''}`;
  return { summary, paymentBasis, paymentText, withdrawalText: CANCELLATION_WITHDRAWAL_NOTICE, withdrawalUrl, version: saved?.version || CANCELLATION_NOTICE_VERSION };
};
