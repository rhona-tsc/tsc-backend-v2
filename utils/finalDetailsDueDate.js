const isoDate = (value) => {
  const match = String(value || "").match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match?.[1] || "";
};

const atNoonUTC = (iso) => new Date(`${iso}T12:00:00.000Z`);

const toISO = (date) => date.toISOString().slice(0, 10);

export const thursdayInWeekBeforeISO = (eventDateValue) => {
  const eventISO = isoDate(eventDateValue);
  if (!eventISO) return "";
  const event = atNoonUTC(eventISO);
  const monday = new Date(event);
  monday.setUTCDate(event.getUTCDate() - ((event.getUTCDay() + 6) % 7));
  const due = new Date(monday);
  due.setUTCDate(monday.getUTCDate() - 4);
  return toISO(due);
};

export const finalDetailsDueISO = (row = {}) => {
  const eventISO = isoDate(row.eventDateISO || row.eventDate || row.date);
  if (!eventISO) return "";
  const standardISO = thursdayInWeekBeforeISO(eventISO);
  const bookingISO = isoDate(
    row.bookingDateISO || row.enquiryDateISO || row.createdAt,
  );
  if (!bookingISO || bookingISO <= standardISO) return standardISO;

  const booked = atNoonUTC(bookingISO);
  const event = atNoonUTC(eventISO);
  if (booked >= event) return eventISO;
  return toISO(new Date(booked.getTime() + (event.getTime() - booked.getTime()) / 2));
};
