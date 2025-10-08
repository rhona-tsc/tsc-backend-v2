// utils/proxySetup.js
import { DateTime } from "luxon";

export function setSharedIVR(book) {
  // book = a Booking mongoose doc or plain object
  const TZ = "Europe/London";

  // derive gig day from your own source of truth:
  const gigISO = book?.cartMeta?.selectedDate   // e.g. "2025-09-21"
    || (book?.date ? new Date(book.date).toISOString().slice(0,10) : null);

  if (!gigISO) return book;

  const gigStart = DateTime.fromISO(gigISO, { zone: TZ }).startOf("day");
  const activeFrom = gigStart.minus({ days: 1 }).set({ hour: 17 });
  const activeUntil = gigStart.plus({ days: 1 }).set({ hour: 2 });

  const ivrCode = ("" + Math.floor(100000 + Math.random()*900000)).slice(0,5); // 5 digits

  book.contactRouting = {
    ...(book.contactRouting || {}),
    provider: "twilio",
    mode: "shared_ivr",
    proxyNumber: process.env.TWILIO_SHARED_IVR_NUMBER, // "+44..."
    ivrCode,
    activeFrom: activeFrom.toJSDate(),
    activeUntil: activeUntil.toJSDate(),
    ringStrategy: book.contactRouting?.ringStrategy || "hunt",
    targets: book.contactRouting?.targets || [], // fill below
    active: true,
    note: "Emergency-only; IVR"
  };

  book.eventSheet = book.eventSheet || {};
  book.eventSheet.emergencyContact = {
    number: process.env.TWILIO_SHARED_IVR_NUMBER,
    ivrCode,
    note: book.eventSheet.emergencyContact?.note
      || "Emergency contact active from 5pm the day before and on the event day.",
    activeWindowSummary: `${activeFrom.toFormat("ccc HH:mm")} → ${activeUntil.toFormat("ccc HH:mm")}`,
  };

  return book;
}