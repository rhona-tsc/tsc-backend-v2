const plain = value => value?.toObject?.() || value;

export function confirmedBookingAvailabilityWrite({board, candidate, contact, eventId, email, now = new Date()}) {
  const bookingId = board.bookingRef || String(board._id);
  const dateISO = String(board.eventDateISO || '').slice(0, 10);
  const musicianId = candidate.musicianId;
  return {
    // An empty/shared phone is not a booking identity. Never reuse a different
    // booking's availability row just because its phone happens to match.
    filter: { musicianId, bookingId, ...(dateISO ? {dateISO} : {}) },
    update: {
      $set: {
        reply: 'yes', status: 'accepted', confirmedBooking: true,
        repliedAt: candidate.respondedAt, updatedAt: now, bookingId,
        calendarEventId: eventId || null, calendarInviteEmail: email || contact.email || '',
        calendarInviteSentAt: eventId && (email || contact.email) ? now : null,
        calendarStatus: 'accepted',
      },
      $setOnInsert: {
        // Scope manual records by booking AND person, even when neither has a
        // phone. Otherwise the enquiry/person/slot unique index collides.
        enquiryId: `booking:${bookingId}:${musicianId}`,
        phone: contact.phone || '', musicianName: candidate.name || '',
        duties: candidate.role, dateISO, formattedDate: dateISO,
        formattedAddress: board.address || board.venue || '',
      },
    },
  };
}

export async function syncConfirmedBookingAssignments({board, booking, BookingModel}) {
  if (!booking?._id) return;
  const members = (board.assignedMusicians || []).map(plain);
  const set = {
    assignedMusicians: members, bookingMusicians: members, bandLineup: members,
    'bookingDetails.assignedMusicians': members,
    'allocation.status': board.allocation?.status || 'in_progress',
    'allocation.lastCheckedAt': board.allocation?.lastCheckedAt || new Date(),
  };
  await BookingModel.collection.updateOne({_id: booking._id}, {$set: set});
}
