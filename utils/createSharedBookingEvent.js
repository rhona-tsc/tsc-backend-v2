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

  const start = booking.eventDateISO + "T17:00:00"; // default start time
  const end   = booking.eventDateISO + "T23:59:00";

  const event = {
    summary: `TSC: Enquiry for ${booking.actName}`,
    description: `Booking reference ${booking.bookingRef}\n${booking.venueAddress}`,
    start: { dateTime: start, timeZone: "Europe/London" },
    end:   { dateTime: end,   timeZone: "Europe/London" },
    extendedProperties: {
      private: {
        bookingRef: booking.bookingRef,
        actId: String(booking.actId),
        eventDateISO: booking.eventDateISO,
      },
    },
    attendees: []  // musicians will be added later
  };

  const created = await cal.events.insert({
    calendarId,
    requestBody: event,
  });

  const eventId = created.data.id;

  // Persist event ID into Booking
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { calendarEventId: eventId } }
  );

  return eventId;
}