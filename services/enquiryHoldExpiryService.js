import mongoose from 'mongoose';
import { google } from 'googleapis';

export const holdExpiresAt = sentAt => new Date(new Date(sentAt).getTime() + 7 * 86400000);
export const memberIsConfirmed = (member, emails) =>
  ['accepted', 'confirmed'].includes(String(member.status).toLowerCase()) &&
  emails.includes(String(member.email || '').trim().toLowerCase());

let running = false;
export async function expireEnquiryHolds({ now = new Date() } = {}) {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const db = mongoose.connection;
    const rows = await db.collection('availabilities').find({
      calendarEventId: { $type: 'string', $ne: '' },
      calendarInviteSentAt: { $lte: new Date(now.getTime() - 7 * 86400000) },
      calendarStatus: { $ne: 'cancelled' }, confirmedBooking: { $ne: true },
      dateISO: { $gte: now.toISOString().slice(0, 10) },
    }).toArray();
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth });
    for (const id of [...new Set(rows.map(row => row.calendarEventId))]) {
      try {
        // Read every request sharing the event: never expire a newer hold or
        // an event which has subsequently become a confirmed booking.
        const requests = await db.collection('availabilities').find({ calendarEventId: id }).toArray();
        if (requests.some(r => r.confirmedBooking || !r.calendarInviteSentAt || holdExpiresAt(r.calendarInviteSentAt) > now)) continue;
        const { data: event } = await calendar.events.get({ calendarId: 'primary', eventId: id });
        if (event.status !== 'cancelled') {
          if (event.extendedProperties?.private?.kind !== 'enquiry_personal') continue;
          const emails = [...new Set(requests.map(r => r.calendarInviteEmail).concat((event.attendees || []).map(a => a.email)).filter(Boolean).map(e => e.trim().toLowerCase()))];
          if (!emails.length) continue;
          const dates = [...new Set(requests.map(r => r.dateISO).filter(Boolean))];
          let protectedBooking = false;
          for (const collection of ['bookings', 'bookingboarditems']) {
            const bookings = await db.collection(collection).find({ $or: [
              { eventDateISO: { $in: dates } }, { date: { $in: dates } },
              { eventDate: { $in: dates } },
              ...dates.flatMap(date => ['date', 'eventDate', 'eventDateISO'].map(field => ({ [field]: { $gte: new Date(`${date}T00:00:00Z`), $lt: new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000) } }))),
              { _id: { $in: requests.map(r => r.bookingId).filter(v => mongoose.isValidObjectId(v)).map(v => new mongoose.Types.ObjectId(v)) } },
              { bookingRef: { $in: requests.map(r => r.bookingId).filter(Boolean) } },
            ] }).toArray();
            if (bookings.some(b => [b.assignedMusicians, b.bookingMusicians, b.bandLineup, b.bookingDetails?.assignedMusicians].flat().filter(Boolean).some(m => memberIsConfirmed(m, emails)))) protectedBooking = true;
          }
          if (protectedBooking) continue;
          await calendar.events.patch({ calendarId: 'primary', eventId: id, requestBody: { status: 'cancelled' }, sendUpdates: 'all' });
        }
        await db.collection('availabilities').updateMany({ calendarEventId: id }, { $set: { calendarStatus: 'cancelled', enquiryHoldExpiredAt: now, calendarCancellationConfirmationPending: false } });
      } catch (error) {
        console.error('Enquiry hold expiry failed', { eventId: id, message: error.message });
      }
    }
  } finally { running = false; }
}
