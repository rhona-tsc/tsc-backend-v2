import { google } from "googleapis";
import Booking from "../models/bookingModel.js";
import { oauth2Client } from "../controllers/googleController.js";

export async function updateOrCreateBookingEvent({ booking }) {
  if (!booking) throw new Error("Missing booking for calendar update");

  const cal = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";

  const eventId = booking.calendarEventId || null;

  const summary = `Confirmed Booking: ${booking.actName}`;
  const description = `
Booking Reference: ${booking.bookingRef}
Act: ${booking.actName}
Date: ${booking.eventDateISO}
Venue: ${booking.venueAddress || booking.venue}
  `.trim();

  const start = `${booking.eventDateISO}T17:00:00`;
  const end = `${booking.eventDateISO}T23:59:00`;

  const eventPayload = {
    summary,
    description,
    start: { dateTime: start, timeZone: "Europe/London" },
    end:   { dateTime: end, timeZone: "Europe/London" },
    extendedProperties: {
      private: {
        bookingRef: booking.bookingRef,
        actId: booking.actId || "",
        eventDateISO: booking.eventDateISO,
      },
    },
  };

  // 1️⃣ UPDATE existing event
  if (eventId) {
    const updated = await cal.events.patch({
      calendarId,
      eventId,
      requestBody: eventPayload,
    });

    return updated.data.id;
  }

  // 2️⃣ CREATE brand-new event (fallback)
  const created = await cal.events.insert({
    calendarId,
    requestBody: eventPayload,
  });

  const newEventId = created.data.id;

  await Booking.updateOne(
    { _id: booking._id },
    { $set: { calendarEventId: newEventId } }
  );

  return newEventId;
}