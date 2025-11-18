import { google } from "googleapis";
import Booking from "../models/bookingModel.js";
import { oauth2Client } from "../controllers/googleController.js";

export async function createSharedBookingEvent({ booking }) {
  if (!booking) throw new Error("No booking passed to createSharedBookingEvent");

  // Already created? → return existing ID
  if (booking.calendarEventId) {
    return booking.calendarEventId;
  }

  const cal = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";

  // 🔥 FIX — use correct bookingId
  const bookingRef = booking.bookingId;

  // 🔥 FIX — compute eventDateISO safely
  const eventDateISO = new Date(booking.date).toISOString().slice(0, 10);

  // 🔥 FIX — always build valid ISO dateTime strings
  const start = `${eventDateISO}T17:00:00`;
  const end   = `${eventDateISO}T23:59:00`;

  const event = {
    summary: `TSC: Enquiry for ${booking.actName || "Act"}`,
    description: `Booking reference ${bookingRef}\n${booking.venueAddress || booking.venue || ""}`,
    start: { dateTime: start, timeZone: "Europe/London" },
    end:   { dateTime: end,   timeZone: "Europe/London" },
    extendedProperties: {
      private: {
        bookingRef,
        actId: String(booking.actId),
        eventDateISO,
      },
    },
    attendees: []
  };

  const created = await cal.events.insert({
    calendarId,
    requestBody: event,
  });

  const eventId = created.data.id;

  await Booking.updateOne(
    { _id: booking._id },
    { $set: { calendarEventId: eventId } }
  );

  return eventId;
}