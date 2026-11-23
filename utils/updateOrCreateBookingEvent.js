import { syncAdditionalBookingSessions } from './additionalBookingSessions.js';
import { google } from "googleapis";
import crypto from "crypto";
import Booking from "../models/bookingModel.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import { oauth2Client } from "../controllers/googleController.js";
import { buildBandSheetShareUrl, getBandSheetOrigin } from "./bandSheetUrl.js";
import { bandSheetTokenPersistenceUpdate } from "./bandSheetTokenRegistry.js";
import { resolveBookedActName } from "./bookingDisplayName.js";
import { calendarMusicianProfiles, calendarMusicianProfileUrl } from './calendarMusicianProfiles.js';
import {upsertSharedBookingCalendar} from './sharedBookingCalendar.js';

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
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const text = clean(raw);
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
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

const lineupFor = async (booking = {}, assignedMusicians = []) => {
  const candidates = [
    assignedMusicians,
    booking.assignedMusicians,
    booking.bandLineup,
    booking.bookingMusicians,
    booking?.bookingDetails?.assignedMusicians,
  ].find((items) => Array.isArray(items) && items.length) || [];
  const members = await calendarMusicianProfiles(candidates
    .filter((member) => ["accepted", "confirmed"].includes(clean(member?.status).toLowerCase())));
  return members
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
      const profile = calendarMusicianProfileUrl(member);
      return [[name || "Band member", role].filter(Boolean).join(" — "), profile].filter(Boolean).join('\n  ');
    });
};

const eventSheetLink = (booking = {}) => {
  const token = clean(booking?.eventSheet?.bandSheetToken);
  if (token) {
    return buildBandSheetShareUrl(token);
  }
  const hostedPdf = clean(
    booking?.eventSheet?.bandPdfUrl || booking?.eventSheet?.pdfUrl,
  );
  if (hostedPdf) return hostedPdf;
  const ref = bookingRefOf(booking);
  return `${getBandSheetOrigin()}/api/booking/${encodeURIComponent(ref)}/event-sheet/pdf`;
};

const calendarClientName = (booking = {}) => {
  const eventType = clean(booking.eventType).toLowerCase();
  const billingName = clean(booking.clientAddress).split(",")[0].trim();
  const looksLikeCompany = /\b(?:ltd|limited|llp|plc|inc|company)\b/i.test(
    billingName,
  );
  if (/corporate|company|business/.test(eventType) && looksLikeCompany) {
    return billingName;
  }
  return clean(
    booking.clientFirstNames || booking.bookerName || booking.clientName || "Client",
  );
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
    await Booking.collection.updateOne(
      identity,
      bandSheetTokenPersistenceUpdate(bandSheetToken),
    );
  } else {
    const bandSheetToken = clean(booking.eventSheet.bandSheetToken);
    const identity = booking._id
      ? { _id: booking._id }
      : { bookingId: bookingRefOf(booking) };
    await Booking.collection.updateOne(identity, {
      $addToSet: { bandSheetTokens: bandSheetToken },
    });
  }

  const cal = google.calendar({ version: "v3", auth: oauth2Client });

  const ref = bookingRefOf(booking);
  const boardBooking = await BookingBoardItem.findOne({
    $or: [
      ...(booking._id ? [{ bookingId: booking._id }, { sourceBookingId: booking._id }] : []),
      ...(ref ? [{ bookingRef: ref }] : []),
    ],
  }).lean();
  const calendarBooking = {
    ...(booking.toObject ? booking.toObject() : booking),
    ...(boardBooking || {}),
    eventSheet: booking.eventSheet,
    calendarEventId: booking.calendarEventId,
  };

  const summaryName = clean(
    resolveBookedActName({ board: boardBooking, booking: calendarBooking }) ||
      firstAct(calendarBooking)?.actName ||
      firstAct(calendarBooking)?.tscName ||
      "Band",
  );
  const times = eventTimes(calendarBooking);
  if (!times.dateISO) throw new Error("Booking has no event date for calendar update");
  const lineup = await lineupFor(calendarBooking, assignedMusicians);

  const clientName = calendarClientName(calendarBooking);
  const possessiveClient = /s$/i.test(clientName)
    ? `${clientName}'`
    : `${clientName}'s`;
  const eventType = clean(calendarBooking.eventType || "Event");
  const summary = `${possessiveClient} ${eventType} | ${summaryName}`;
  const description = [
    `Booking Reference: ${ref}`,
    `Act: ${summaryName}`,
    `Date: ${times.dateISO}`,
    `Venue: ${clean(calendarBooking.address || calendarBooking.venueAddress || calendarBooking.venue) || "TBC"}`,
    "",
    "BAND MEMBERS & ROLES:",
    ...(lineup.length ? lineup.map((entry) => `• ${entry}`) : ["• Awaiting confirmations"]),
    "",
    `EVENT SHEET: ${eventSheetLink(booking)}`,
    clean(calendarBooking.whatsappGroupLink)
      ? `WHATSAPP BAND GROUP: ${clean(calendarBooking.whatsappGroupLink)}`
      : "",
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");

  const eventPayload = {
    summary,
    description,
    location: clean(
      calendarBooking.address || calendarBooking.venueAddress || calendarBooking.venue,
    ),
    start: { dateTime: times.start, timeZone: "Europe/London" },
    end: { dateTime: times.end, timeZone: "Europe/London" },
    extendedProperties: {
      private: {
        bookingRef: ref,
        bookingRecordId: String(booking._id || ""),
        actId:
          calendarBooking.actId ||
          firstAct(calendarBooking)?.actId ||
          calendarBooking.act ||
          "",
        eventDateISO: times.dateISO,
      },
    },
  };

  const assignments = assignedMusicians.length ? assignedMusicians : calendarBooking.assignedMusicians || [];
  const resolved = await upsertSharedBookingCalendar({cal,booking,ref,payload:eventPayload,assignments});
  await Booking.collection.updateOne(
    booking._id ? {_id:booking._id} : {bookingId:ref},
    {$set:{calendarEventId:resolved.eventId,calendarId:resolved.calendarId}},
  );
  // Callers may immediately add a recipient; give them the resolved calendar.
  booking.calendarId = resolved.calendarId;
  booking.calendarEventId = resolved.eventId;
  await syncAdditionalBookingSessions({cal,calendarId:resolved.calendarId,booking,assignments});
  return resolved.eventId;
}
