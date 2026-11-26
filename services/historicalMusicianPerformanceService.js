import crypto from 'node:crypto';
import { completedBooking, confirmedRoster } from '../utils/performanceRoster.js';

export const HISTORY_VERSION = 2;
export const historyEmail = value => String(value || '').trim().toLowerCase().replace(/@googlemail\.com$/, '@gmail.com');
const key = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const id = value => String(value || '');
const clientKey = value => key(String(value || '').replace(/[’']s\b/g, '').replace(/\b(?:\d+(?:st|nd|rd|th)?\s+)?(?:wedding|anniversary|birthday|corporate\s+event|party|reception)(?:\s+party)?\s*$/i, '').trim());
const allocationRows = b => b.assignedMusicians?.length ? b.assignedMusicians : b.bookingDetails?.assignedMusicians?.length ? b.bookingDetails.assignedMusicians : b.bookingMusicians?.length ? b.bookingMusicians : b.bandLineup || [];
export function buildHistoricalIdentityIndex(profiles, contacts = []) {
  const byId = new Map(profiles.map(m => [id(m._id), m]));
  const emails = new Map(), ids = new Map();
  const add = (map, value, canonical) => { if (!value) return; if (!map.has(value)) map.set(value, new Set()); map.get(value).add(canonical); };
  const resolve = profile => {
    const seen = new Set();
    while (profile?.mergedIntoMusicianId) {
      if (seen.has(id(profile._id)) || profile.privateTestProfile) return null;
      seen.add(id(profile._id)); profile = byId.get(id(profile.mergedIntoMusicianId));
    }
    return profile && !profile.privateTestProfile && !profile.profileDeletedAt ? profile : null;
  };
  for (const profile of profiles) {
    if (profile.privateTestProfile) continue;
    const canonical = resolve(profile); if (!canonical) continue;
    const canonicalId = id(canonical._id);
    for (const value of [profile._id, profile.musicianId, ...(profile.mergedProfileIds || [])].map(id)) add(ids, value, canonicalId);
    for (const value of [profile.email, ...(profile.mergedProfileEmails || []), ...(profile.mergedProfileContacts || []).map(c => c.email)].map(historyEmail)) add(emails, value, canonicalId);
  }
  const unique = values => values?.size === 1 ? [...values][0] : '';
  // Only explicit saved musician IDs may supply an older contact alias.
  // Names or a shared telephone number never merge people or login accounts.
  for (const contact of contacts) {
    const canonical = unique(ids.get(id(contact.musicianId)));
    if (canonical && contact.email) add(emails, historyEmail(contact.email), canonical);
  }

  return {
    resolveEmail: value => unique(emails.get(historyEmail(value))),
    ambiguousEmail: value => (emails.get(historyEmail(value))?.size || 0) > 1,
    resolveMember: member => {
      if (!member || typeof member !== 'object') return '';
      const byIdentifier = unique(ids.get(id(member.musicianId || member.musician?._id)));
      const byAddress = unique(emails.get(historyEmail(member.email)));
      // A conflicting ID and email needs staff reconciliation, never a guess.
      return byIdentifier && byAddress && byIdentifier !== byAddress ? '' : byIdentifier || byAddress;
    },
    profiles: byId,
  };
}
export function mergePerformanceBookings(board, core) {
  const linked = (row,b) => [row.bookingId,row.sourceBookingId].filter(Boolean).some(v => id(v) === id(b._id)) || (row.bookingRef && key(row.bookingRef) === key(b.bookingRef || b.bookingId));
  const rows = board.map(row => {
    const original = core.find(b => linked(row,b));
    return { ...original, ...row, ...(!allocationRows(row).length && original ? { assignedMusicians: allocationRows(original) } : {}) };
  });
  return [...rows, ...core.filter(b => !board.some(row => linked(row,b)))];
}
export function calendarEventDate(event) {
  const raw = event.start?.date || event.start?.dateTime || event.start;
  const start = raw instanceof Date ? raw.toISOString() : raw;
  if (typeof start !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  const value = new Date(start); if (!Number.isFinite(+value)) return '';
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
}
function matchBooking(event, date, bookings) {
  const explicit = String(event.extendedProperties?.private?.bookingRef || event.description?.match(/(?:Booking\s+Reference|Booking\s+Ref)\s*:\s*([^\n\r<]+)/i)?.[1] || '').trim();
  const recordId = id(event.extendedProperties?.private?.bookingRecordId);
  const candidates = bookings.filter(b => {
    if (b.calendarEventId === event.id && (!b.calendarId || b.calendarId === event.calendarId)) return true;
    if (recordId && id(b._id) === recordId) return true;
    if (explicit) return key(b.bookingRef || b.bookingId) === key(explicit);
    return false;
  });
  if (candidates.length) return candidates.length === 1 ? { booking:candidates[0] } : { ambiguous:true };
  if (explicit || recordId) return { missingExplicit:true };
  const sameDate = bookings.filter(b => calendarEventDate({start:b.eventDateISO || b.date || b.eventDate?.toISOString?.() || ''}) === date);
  const venue = key(event.location), title = clientKey(String(event.summary || '').split('|')[0]);
  const matches = sameDate.filter(b => {
    const place = key(b.address || b.venueAddress || b.venue || b.bookingDetails?.venueAddress);
    const names = [b.eventTitle, b.clientName, (Array.isArray(b.clientFirstNames) ? b.clientFirstNames.join(' ') : b.clientFirstNames), b.bookingDetails?.clientName].filter(Boolean).map(clientKey);
    // Date + exact venue + exact client/event title are all required here.
    return venue && place === venue && title && names.includes(title);
  });
  return matches.length === 1 ? {booking:matches[0]} : {ambiguous:matches.length > 1 || sameDate.some(b => venue && key(b.address || b.venueAddress || b.venue || b.bookingDetails?.venueAddress) === venue)};
}
export function buildHistoricalPerformances({ events, profiles, board = [], core = [], contacts = [], actNames = [], today }) {
  const identity = buildHistoricalIdentityIndex(profiles, contacts);
  const bookings = mergePerformanceBookings(board, core);
  const records = [], review = [];
  const rejectedTitle = /\b(reminder|catch up|call|meeting|rehearsal|accounts|invoice|quote|enquiry|unavailable|cancelled|canceled|hold)\b/i;
  for (const event of events) {
    const date = calendarEventDate(event);
    const sourceKey = `${event.calendarId}:${event.id}`;
    const hold = (reason, extra={}) => review.push({sourceKey,date,title:event.summary,reason,...extra});
    if (event.calendarCategory && event.calendarCategory !== 'performance') {hold('Not a performance calendar');continue;}
    if (!date || date >= today || event.status !== 'confirmed' || rejectedTitle.test(event.summary || '')) { hold('Not a completed confirmed gig'); continue; }
    const match = matchBooking(event,date,bookings);
    if (match.ambiguous) {hold('More than one booking matches');continue;}
    if (match.missingExplicit) {hold('Explicit booking reference could not be matched');continue;}
    const booking = match.booking;
    if (booking && (!completedBooking(booking,today) || calendarEventDate({start:booking.eventDateISO || booking.date || booking.eventDate?.toISOString?.() || ''}) !== date)) {hold('Linked booking was cancelled, provisional or has a different date');continue;}
    const allocation = (booking ? allocationRows(booking) : []).filter(member => member && typeof member.status === 'string');
    const allocatedIds = new Set((booking ? confirmedRoster(booking) : []).map(identity.resolveMember).filter(Boolean));
    const musicians = new Set(allocatedIds);
    const evidence = new Map([...allocatedIds].map(value => [value,'confirmed_allocation']));
    const ambiguous = [], unresolved = [];
    if (!allocation.length) for (const guest of event.attendees || []) {
      if ((guest.responseStatus || guest.response_status) !== 'accepted' || guest.optional || guest.resource || guest.isOrganizer || guest.organizer) continue;
      const person = identity.resolveEmail(guest.email);
      if (person) { musicians.add(person); evidence.set(person,'accepted_gig_invitation'); }
      else (identity.ambiguousEmail(guest.email) ? ambiguous : unresolved).push(historyEmail(guest.email));
    }
    const detail = String(event.description || '').replace(/<[^>]+>/g,' ');
    const performanceTerms = /\b(?:band members|soundcheck|set times|line[ -]?up|lead vocal|bass guitar|live performance|performance times|gig details|on stage|musicians required)\b/i.test(detail);
    const namedBand = actNames.some(name => String(name).trim().length >= 5 && `${event.summary || ''} ${detail}`.toLowerCase().includes(String(name).trim().toLowerCase()));
    const trustedGigDiary = event.calendarId === 'c_0kbngahob779qdifdav366hqtc@group.calendar.google.com';
    const legacyGigTitle = !event.calendarCategory && event.location && /\b(wedding|party|birthday|corporate|gig|anniversary|reception|festival|concert|christmas|nye|nyd|ball|awards|launch|performance)\b/i.test(event.summary || '');
    const gigMarker = /event\s*sheet|booking\s*ref/i.test(detail) || Boolean(booking) || performanceTerms || namedBand || trustedGigDiary || legacyGigTitle;
    if (!gigMarker) {hold('No reliable gig marker');continue;}
    if (musicians.size < 2) {hold('Fewer than two verified musician identities',{ambiguous,unresolved});continue;}
    records.push({_id:crypto.createHash('sha256').update(sourceKey).digest('hex'),source:'calendar_history',sourceCalendarId:event.calendarId,sourceEventId:event.id,eventDateISO:date,
      bookingRef:String(booking?.bookingRef || ''),bookingRecordId:booking?._id ? id(booking._id) : '',
      musicianIds:[...musicians].sort(),evidence:[...evidence].map(([musicianId,basis])=>({musicianId,basis})),status:'verified',algorithmVersion:HISTORY_VERSION});
    if (ambiguous.length || unresolved.length) hold('Some invited identities were left unresolved',{ambiguous,unresolved});
  }
  return {records,review,identity};
}
