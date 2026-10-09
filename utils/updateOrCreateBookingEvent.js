import { google } from "googleapis";
import crypto from "crypto";
import Booking from "../models/bookingModel.js";
import { oauth2Client } from "../controllers/googleController.js";

const clean = (value = "") => String(value || "").trim();

const firstAct = (booking = {}) => booking?.actsSummary?.[0] || {};

const bookingRefOf = (booking = {}) =>
  clean(booking.bookingRef || booking.bookingId || booking._id);

const dateOf = (booking = {}) => {
  const raw =
    booking.eventDateISO ||
    booking.eventDate ||
    booking.date ||
    booking?.eventSheet?.answers?.event_date ||
    firstAct(booking)?.performance?.date ||
    "";
  if (!raw) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return clean(raw).slice(0, 10);
};

const normaliseTime = (value, fallback) => {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return `${String(Math.min(23, Number(match[1]))).padStart(2, "0")}:${match[2]}`;
};

const eventTimes = (booking = {}) => {
  const performance = {
    ...(firstAct(booking)?.performance || {}),
    ...(booking.performanceTimes || {}),
  };
  const dateISO = dateOf(booking);
  const arrival = normaliseTime(
    performance.arrivalTime || booking.arrivalTime,
    "17:00",
  );
  const finish = normaliseTime(
    performance.finishTime || booking.finishTime,
    "23:59",
  );
  let finishDayOffset = Number(
    performance.finishDayOffset ?? booking.finishDayOffset ?? 0,
  );
  if (!finishDayOffset && finish <= arrival) finishDayOffset = 1;
  const endDate = new Date(`${dateISO}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + Math.max(0, finishDayOffset));
  return {
    dateISO,
    start: `${dateISO}T${arrival}:00`,
    end: `${endDate.toISOString().slice(0, 10)}T${finish}:00`,
  };
};

const lineupFor = (booking = {}, assignedMusicians = []) => {
  const candidates = [
    assignedMusicians,
    booking.assignedMusicians,
    booking.bandLineup,
    booking.bookingMusicians,
    booking?.bookingDetails?.assignedMusicians,
  ].find((items) => Array.isArray(items) && items.length) || [];
  return candidates
    .filter((member) => ["accepted", "confirmed"].includes(clean(member?.status).toLowerCase()))
    .map((member) => {
      const name = clean(
        member?.name || [member?.firstName, member?.lastName].filter(Boolean).join(" "),
      );
      const duties = Array.isArray(member?.duties)
        ? member.duties.map(clean).filter(Boolean)
        : [];
      const role = [member?.role || member?.instrument, ...duties]
        .map(clean)
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(" · ");
      return [name || "Band member", role].filter(Boolean).join(" — ");
    });
};

const eventSheetLink = (booking = {}) => {
  const token = clean(booking?.eventSheet?.bandSheetToken);
  const backend = clean(
    process.env.BACKEND_PUBLIC_URL ||
      process.env.BACKEND_URL ||
      "https://tsc-backend-v2.onrender.com",
  ).replace(/\/$/, "");
  if (token) {
    return `${backend}/api/booking/band-sheet/${encodeURIComponent(token)}`;
  }
  const hostedPdf = clean(
    booking?.eventSheet?.bandPdfUrl || booking?.eventSheet?.pdfUrl,
  );
  if (hostedPdf) return hostedPdf;
  const ref = bookingRefOf(booking);
  return `${backend}/api/booking/${encodeURIComponent(ref)}/event-sheet/pdf`;
};

export async function updateOrCreateBookingEvent({ booking, assignedMusicians = [] }) {
  if (!booking) throw new Error("Missing booking for calendar update");

  if (!clean(booking?.eventSheet?.bandSheetToken)) {
    const bandSheetToken = crypto.randomBytes(18).toString("base64url");
    booking.eventSheet = {
      ...(booking.eventSheet || {}),
      bandSheetToken,
    };
    const identity = booking._id
      ? { _id: booking._id }
      : { bookingId: bookingRefOf(booking) };
    await Booking.collection.updateOne(identity, {
      $set: { "eventSheet.bandSheetToken": bandSheetToken },
    });
  }

  const cal = google.calendar({ version: "v3", auth: oauth2Client });
  const calendarId = "primary";

  const eventId = booking.calendarEventId || null;
  const summaryName = clean(
    booking.actName || firstAct(booking)?.actName || firstAct(booking)?.tscName || "Band",
  );
  const ref = bookingRefOf(booking);
  const times = eventTimes(booking);
  if (!times.dateISO) throw new Error("Booking has no event date for calendar update");
  const lineup = lineupFor(booking, assignedMusicians);

  const summary = `Confirmed Booking: ${summaryName}`;
  const description = [
    `Booking Reference: ${ref}`,
    `Act: ${summaryName}`,
    `Date: ${times.dateISO}`,
    `Venue: ${clean(booking.venueAddress || booking.venue) || "TBC"}`,
    "",
    "BAND MEMBERS & ROLES:",
    ...(lineup.length ? lineup.map((entry) => `• ${entry}`) : ["• Awaiting confirmations"]),
    "",
    `EVENT SHEET: ${eventSheetLink(booking)}`,
  ].join("\n");

  const eventPayload = {
    summary,
    description,
    location: clean(booking.venueAddress || booking.venue),
    start: { dateTime: times.start, timeZone: "Europe/London" },
    end: { dateTime: times.end, timeZone: "Europe/London" },
    extendedProperties: {
      private: {
        bookingRef: ref,
        actId: booking.actId || firstAct(booking)?.actId || booking.act || "",
        eventDateISO: times.dateISO,
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

  await Booking.collection.updateOne(
    { _id: booking._id },
    { $set: { calendarEventId: newEventId } },
  );

  return newEventId;
}
