const isoDate = (value) => {
  const match = String(value || "").match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match?.[1] || "";
};

const atNoonUTC = (iso) => new Date(`${iso}T12:00:00.000Z`);

const toISO = (date) => date.toISOString().slice(0, 10);

const dateFromUTCParts = (year, monthIndex, day) =>
  new Date(Date.UTC(year, monthIndex, day, 12));

const observedHolidayISO = (year, monthIndex, day) => {
  const actual = dateFromUTCParts(year, monthIndex, day);
  const weekday = actual.getUTCDay();
  if (weekday === 6) actual.setUTCDate(actual.getUTCDate() + 2);
  if (weekday === 0) actual.setUTCDate(actual.getUTCDate() + 1);
  return toISO(actual);
};

const nthWeekdayOfMonth = (year, monthIndex, weekday, occurrence) => {
  const date = dateFromUTCParts(year, monthIndex, 1);
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + ((occurrence - 1) * 7));
  return date;
};

const lastWeekdayOfMonth = (year, monthIndex, weekday) => {
  const date = dateFromUTCParts(year, monthIndex + 1, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7));
  return date;
};

const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateFromUTCParts(year, month - 1, day);
};

export const englandAndWalesBankHolidayISOs = (year) => {
  const holidays = new Set([
    observedHolidayISO(year, 0, 1),
    toISO(nthWeekdayOfMonth(year, 4, 1, 1)),
    toISO(lastWeekdayOfMonth(year, 4, 1)),
    toISO(lastWeekdayOfMonth(year, 7, 1)),
  ]);

  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(easter.getUTCDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setUTCDate(easter.getUTCDate() + 1);
  holidays.add(toISO(goodFriday));
  holidays.add(toISO(easterMonday));

  const christmas = dateFromUTCParts(year, 11, 25);
  const boxingDay = dateFromUTCParts(year, 11, 26);
  holidays.add(toISO(christmas));
  holidays.add(toISO(boxingDay));
  for (const holiday of [christmas, boxingDay]) {
    if (![0, 6].includes(holiday.getUTCDay())) continue;
    const substitute = new Date(holiday);
    do {
      substitute.setUTCDate(substitute.getUTCDate() + 1);
    } while (
      [0, 6].includes(substitute.getUTCDay()) ||
      holidays.has(toISO(substitute))
    );
    holidays.add(toISO(substitute));
  }

  return holidays;
};

export const isWorkingDayISO = (value) => {
  const iso = isoDate(value);
  if (!iso) return false;
  const date = atNoonUTC(iso);
  if ([0, 6].includes(date.getUTCDay())) return false;
  // TSC closes on Christmas Eve even though it is not an official UK bank holiday.
  if (iso.slice(5) === "12-24") return false;
  return !englandAndWalesBankHolidayISOs(date.getUTCFullYear()).has(iso);
};

export const previousWorkingDayISO = (value) => {
  const iso = isoDate(value);
  if (!iso) return "";
  const date = atNoonUTC(iso);
  while (!isWorkingDayISO(toISO(date))) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return toISO(date);
};

export const thursdayInWeekBeforeISO = (eventDateValue) => {
  const eventISO = isoDate(eventDateValue);
  if (!eventISO) return "";
  const event = atNoonUTC(eventISO);
  const monday = new Date(event);
  monday.setUTCDate(event.getUTCDate() - ((event.getUTCDay() + 6) % 7));
  const due = new Date(monday);
  due.setUTCDate(monday.getUTCDate() - 4);
  return previousWorkingDayISO(toISO(due));
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
  const calendarDays = Math.round((event.getTime() - booked.getTime()) / 86400000);
  const midpoint = new Date(booked);
  midpoint.setUTCDate(booked.getUTCDate() + Math.floor(calendarDays / 2));
  const midpointISO = toISO(midpoint);
  const workingISO = previousWorkingDayISO(midpointISO);
  return workingISO < bookingISO ? bookingISO : workingISO;
};
