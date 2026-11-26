const text = value => String(value || '').trim();
export function confirmedRoster(booking) {
  const rows = booking.assignedMusicians?.length ? booking.assignedMusicians : booking.bookingDetails?.assignedMusicians?.length ? booking.bookingDetails.assignedMusicians : booking.bookingMusicians?.length ? booking.bookingMusicians : booking.bandLineup || [];
  return rows.filter(m => ['accepted', 'confirmed', 'completed'].includes(text(m.status).toLowerCase()) && (!m.withdrawnAt || new Date(m.acceptedAt || m.respondedAt || 0) > new Date(m.withdrawnAt)));
}
export function completedBooking(booking, today) {
  if (['cancelled', 'canceled', 'provisional', 'enquiry', 'declined'].includes(text(booking.bookingStatus || booking.status).toLowerCase())) return false;
  const value = booking.eventDateISO || booking.date || booking.eventDate || booking.bookingDetails?.eventDate;
  const date = value instanceof Date ? value.toISOString().slice(0,10) : text(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
}
