import Venue from '../models/venueModel.js';
import Booking from '../models/bookingModel.js';
import mongoose from 'mongoose';

const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export async function lookupVoiceVenueHistory(venue, { loadVenues, loadBookings, now = new Date() } = {}) {
  if (!venue?.name || !venue?.postcode || venue.addressIncomplete || venue.countyConflict) throw new Error('Confirm one exact venue and postcode before checking its history.');
  const name = { $regex: `^${escape(venue.name)}$`, $options: 'i' };
  const venues = await (loadVenues || (()=>Venue.find({postcode:venue.postcode,$or:[{name},{aliases:name}]}).select('_id name postcode visits.bookingId visits.eventDate').limit(3).maxTimeMS(3000).lean()))(venue);
  const empty = reason => ({ historyFound: false, pastGigCount: 0, reason, readOnly: true, instruction: 'Do not invent familiarity, dates or a visit count.' });
  if (venues.length !== 1) return empty(venues.length ? 'The venue record is ambiguous.' : 'No exact venue history is linked to this address.');
  const past = (venues[0].visits || []).filter(visit=>visit.eventDate && Number.isFinite(+new Date(visit.eventDate)) && new Date(visit.eventDate).toISOString().slice(0,10) < now.toISOString().slice(0,10)).slice(0,200);
  const ids = [...new Set(past.map(visit=>String(visit.bookingId || '')).filter(Boolean))];
  const bookings = ids.length ? await (loadBookings || (async ids=>Booking.find({$or:[{bookingId:{$in:ids}},{_id:{$in:ids.filter(id=>mongoose.isValidObjectId(id)).map(id=>new mongoose.Types.ObjectId(id))}}]}).select('_id bookingId status bookingStatus').limit(200).maxTimeMS(3000).lean()))(ids) : [];
  const cancelled = new Set(bookings.filter(row=>/cancel|declin|refund|lost/i.test(`${row.status || ''} ${row.bookingStatus || ''}`)).flatMap(row=>[String(row._id),String(row.bookingId)]));
  const unique = new Map();
  for (const visit of past) {
    const id = String(visit.bookingId || ''); if (cancelled.has(id)) continue;
    // One event counts once even when several acts share it. Unknown source visits use the date.
    const day = new Date(visit.eventDate).toISOString().slice(0,10), key = day;
    unique.set(key,day);
  }
  const dates = [...unique.values()].sort();
  if (!dates.length) return empty('No past dated gig records remain after excluding cancelled bookings.');
  const monthYear = date => new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',month:'long',year:'numeric'}).format(new Date(`${date}T12:00:00Z`));
  return { historyFound: true, venueName: venues[0].name, pastGigCount: dates.length, latestGigMonth: monthYear(dates.at(-1)),
    thisYearMonths: [...new Set(dates.filter(day=>day.startsWith(String(now.getUTCFullYear()))).map(monthYear))].slice(-3),
    suggestedWording: dates.length >= 3 ? `Our venue records show several previous gigs there, most recently in ${monthYear(dates.at(-1))}.` : `Our venue records show a previous gig there in ${monthYear(dates.at(-1))}.`,
    readOnly: true, instruction: 'Use one brief friendly sentence only. This is TSC venue history, not proof this particular band/lineup played there. Do not disclose client names, exact event dates, booking references, musician details, notes or access links.' };
}
