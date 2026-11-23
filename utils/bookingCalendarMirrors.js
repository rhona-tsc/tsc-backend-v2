import {extractBookingRefFromCalendarEvent} from './calendarBookingIdentity.js';

const clean = value => String(value || '').trim();
const emailKey = value => clean(value).toLowerCase().replace(/@googlemail\.com$/, '@gmail.com');
const confirmed = member => ['accepted','confirmed'].includes(clean(member.status).toLowerCase()) && !member.withdrawnAt;

// A booking acceptance and a Google RSVP are separate facts. Preserve each
// guest's actual response rather than claiming they accepted the invitation.
export function bookingCalendarAttendees(existing = [], assignments = []) {
  const active = new Set(assignments.filter(confirmed).map(member => emailKey(member.email)).filter(Boolean));
  const inactive = new Set(assignments.filter(member => !confirmed(member)).map(member => emailKey(member.email)).filter(Boolean));
  const guests = new Map(existing.filter(guest => !inactive.has(emailKey(guest.email)) || active.has(emailKey(guest.email)))
    .map(guest => [emailKey(guest.email), {...guest}]));
  for (const member of assignments.filter(confirmed)) {
    const email = clean(member.email).toLowerCase();
    if (!email) continue;
    const key = emailKey(email);
    guests.set(key, {...(guests.get(key) || {}), email});
  }
  return [...guests.values()];
}

// Only explicitly linked, already verified diary copies are updated. Never
// discover or create extra invitations by matching a client's name alone.
export async function syncBookingCalendarMirrors({cal, booking, calendarId, eventId, payload, assignments = []}) {
  const ref = clean(booking.bookingRef || booking.bookingId);
  const seen = new Set([`${calendarId}:${eventId}`]);
  for (const target of booking.calendarMirrors || []) {
    const targetCalendar = clean(target.calendarId), targetEvent = clean(target.eventId);
    const key = `${targetCalendar}:${targetEvent}`;
    if (!targetCalendar || !targetEvent || seen.has(key)) continue;
    seen.add(key);
    let existing;
    try { existing = (await cal.events.get({calendarId:targetCalendar,eventId:targetEvent})).data; }
    catch (error) { if ([404,410].includes(Number(error.code || error.status))) continue; throw error; }
    if (!ref || existing.status === 'cancelled' || extractBookingRefFromCalendarEvent(existing) !== ref) continue;
    const requestBody = {summary:payload.summary,description:payload.description,location:payload.location,
      attendees:bookingCalendarAttendees(existing.attendees,assignments)};
    const guestState = guests => JSON.stringify((guests || []).map(guest=>[emailKey(guest.email),guest.responseStatus || 'needsAction']).sort());
    if (existing.summary === requestBody.summary && existing.description === requestBody.description &&
        existing.location === requestBody.location && guestState(existing.attendees) === guestState(requestBody.attendees)) continue;
    // Keep this copy's existing date/time and RSVP responses intact.
    await cal.events.patch({calendarId:targetCalendar,eventId:targetEvent,requestBody,sendUpdates:'all'});
  }
}
