import { google } from 'googleapis';
import crypto from 'node:crypto';

export const CALL_CALENDAR_ID = 'rhona@thesupremecollective.co.uk';
export const CALL_SCHEDULE = { timeZone: 'Europe/London', durationMinutes: 20, days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], startHour: 10, endHour: 16 };
const london = new Intl.DateTimeFormat('en-GB', { timeZone: CALL_SCHEDULE.timeZone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = date => Object.fromEntries(london.formatToParts(date).map(item => [item.type, item.value]));
export function appointmentWindow(input, now = new Date()) {
  const day = input?.dateISO;
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day || +date < +now - 86400000 || +date > +now + 30 * 86400000) throw new Error('Ask for a valid callback date within the next 30 days, including the year.');
  const p = parts(date), offsetHours = Number(p.hour) - 12;
  const start = new Date(`${day}T${String(10 - offsetHours).padStart(2, '0')}:00:00Z`), end = new Date(+start + 6 * 3600000);
  return { start, end, day, weekday: p.weekday };
}
export function appointmentSlots(input, { events = [], now = new Date() } = {}) {
  const window = appointmentWindow(input, now);
  if (!CALL_SCHEDULE.days.includes(window.weekday)) return [];
  const busy = events.filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent').map(event => {
    // Calendar blocking includes all-day entries and declined invitations only when accepted/not declined.
    if (event.attendees?.some(attendee => attendee.self && attendee.responseStatus === 'declined')) return null;
    if (event.start?.date) return event.start.date <= window.day && event.end?.date > window.day ? { start: window.start, end: window.end } : null;
    return { start: new Date(event.start?.dateTime), end: new Date(event.end?.dateTime) };
  }).filter(Boolean);
  if (busy.some(item => !Number.isFinite(+item.start) || !Number.isFinite(+item.end))) throw new Error('Calendar blocking could not be verified. Offer a callback request instead.');
  const result = [];
  for (let time = +window.start; time + 20 * 60000 <= +window.end; time += 20 * 60000) {
    const end = time + 20 * 60000;
    if (time < +now + 30 * 60000 || busy.some(item => time < +item.end && end > +item.start)) continue;
    const startISO = new Date(time).toISOString(), endISO = new Date(end).toISOString();
    const p = parts(new Date(time));
    result.push({ slotId: crypto.createHash('sha256').update(`${CALL_CALENDAR_ID}|${startISO}`).digest('hex').slice(0, 24), startISO, endISO, label: `${window.weekday} ${p.day}/${p.month}/${p.year} at ${p.hour}:${p.minute} UK time` });
  }
  return result;
}
export async function lookupVoiceCallSlots(input, { now = new Date(), loadEvents } = {}) {
  const window = appointmentWindow(input, now);
  if (!CALL_SCHEDULE.days.includes(window.weekday)) return { slots: [], schedule: CALL_SCHEDULE, testMode: true, bookingConfirmed: false, reason: 'Human calls are Monday to Thursday, 10am to 4pm UK time.' };
  const load = loadEvents || (async () => {
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const response = await google.calendar({ version: 'v3', auth }).events.list({ calendarId: CALL_CALENDAR_ID, timeMin: window.start.toISOString(), timeMax: window.end.toISOString(), singleEvents: true, maxResults: 250, fields: 'nextPageToken,items(status,transparency,start,end,attendees(self,responseStatus))' }, { timeout: 6000 });
    if (response.data.nextPageToken) throw new Error('Calendar has too many entries to verify safely.');
    return response.data.items || [];
  });
  const slots = appointmentSlots(input, { events: await load(window), now });
  return { slots: slots.slice(0, 18), schedule: CALL_SCHEDULE, checkedAt: now.toISOString(), testMode: true, bookingConfirmed: false, instruction: 'Offer at most three suitable times. After the caller chooses, save their confirmed callback details, then prepare_call_appointment. In test mode this is only a proposed appointment; no calendar event or invitation is created.' };
}
