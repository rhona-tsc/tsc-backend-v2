const normaliseSource = (source = "") =>
  String(source || "")
    .trim()
    .toLowerCase();

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const subtractDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
};

const getThursdayAtLeast7DaysBefore = (eventDate) => {
  const d = subtractDays(eventDate, 7);

  // JS day: 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu...
  while (d.getDay() !== 4) {
    d.setDate(d.getDate() - 1);
  }

  return d;
};

const getTscStandardBalanceDate = (eventDate, bookingMadeDate = new Date()) => {
  const event = new Date(eventDate);
  const made = new Date(bookingMadeDate || new Date());

  const diffDays = Math.ceil((event - made) / (1000 * 60 * 60 * 24));

  if (diffDays <= 28) {
    return made;
  }

  return subtractDays(event, 14);
};

export const getExpectedBalanceDateForSource = ({
  source,
  eventDate,
  bookingMadeDate,
}) => {
  if (!eventDate) return undefined;

  const sourceKey = normaliseSource(source);

  const fiveDaysAfter = ["encore", "wedding jam"];

  const fourteenDaysAfter = [
    "silk street",
    "scarlett entertainment",
    "scarlette entertainment",
    "freak music",
    "function central",
  ];

  const thursdayBefore = [
    "",
    "other",
    "alive network",
    "entertainment nation",
    "entertainment nation",
    "warble",
    "poptop",
    "lmm",
    "last minute musicians",
    "staar productions",
    "ukbride",
  ];

  const tscStandard = [
    "direct",
    "tsc",
    "the supreme collective",
    "bamboo music management",
    "bmm",
  ];

  if (fiveDaysAfter.includes(sourceKey)) {
    return addDays(eventDate, 5);
  }

  if (fourteenDaysAfter.includes(sourceKey)) {
    return addDays(eventDate, 14);
  }

  if (thursdayBefore.includes(sourceKey)) {
    return getThursdayAtLeast7DaysBefore(eventDate);
  }

  if (tscStandard.includes(sourceKey)) {
    return getTscStandardBalanceDate(eventDate, bookingMadeDate);
  }

  return getThursdayAtLeast7DaysBefore(eventDate);
};

export default getExpectedBalanceDateForSource;