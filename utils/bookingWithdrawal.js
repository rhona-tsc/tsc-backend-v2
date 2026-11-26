const identity = person => String(person?.musicianId || person?._id || person?.id || person?.userId || '');
const email = person => String(person?.email || '').trim().toLowerCase();
export const ownsBookingAssignment = (entry = {}, user = {}) => Boolean(
  (identity(user) && String(entry.musicianId || '') === identity(user)) ||
  (email(user) && email(entry) === email(user)),
);
export function isWithdrawalTarget(entry, assignment, user) {
  if (!ownsBookingAssignment(entry, user)) return false;
  if (assignment.roleSlotId) return String(entry.roleSlotId || '') === String(assignment.roleSlotId);
  if (assignment.offerRequestId) return entry.offerRequestId === assignment.offerRequestId;
  return String(entry.role || entry.instrument || '').trim().toLowerCase() === String(assignment.role || assignment.instrument || '').trim().toLowerCase();
}
export function withdrawalAvailabilityRecord({ board, assignment, phone, reason, source, now }) {
  const dateISO = String(board.eventDateISO || board.eventDate || board.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new Error('The booking needs an event date before availability can be withdrawn.');
  const musicianId = String(assignment.musicianId || '');
  if (!musicianId && !phone) throw new Error('The musician allocation needs a profile or phone number.');
  const requestKey = `booking-withdrawal:${board._id}:${assignment.roleSlotId || assignment.role || assignment.instrument}:${musicianId || phone}`;
  const oid = value => /^[a-f0-9]{24}$/i.test(String(value || ''));
  return { enquiryId: requestKey, requestKey, dateISO, bookingId: String(board.bookingRef || board._id),
    ...(oid(musicianId) ? { musicianId } : {}),
    ...(phone ? { phone, ...(oid(board.actId) ? { actId: board.actId } : {}) } : {}),
    musicianName: assignment.name || [assignment.firstName, assignment.lastName].filter(Boolean).join(' '),
    musicianEmail: email(assignment), actName: board.actTscName || board.actName || '',
    duties: assignment.role || assignment.instrument || 'Musician', fee: String(assignment.totalFee || assignment.fee || ''),
    reply: 'unavailable', status: 'unavailable', repliedAt: now, updatedAt: now,
    replyHistory: [{ reply: 'unavailable', occurredAt: now, receivedAt: now,
      source: source || 'musician_portal', body: String(reason || '').trim(),
      evidence: 'Confirmed booking withdrawal' }],
    inbound: { source, body: String(reason || '').trim() || 'Musician withdrew availability for this confirmed booking.', readByAdmin: false },
  };
}
