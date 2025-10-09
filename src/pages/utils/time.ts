// utils/time.ts
export const parseHHMM = (hhmm: string) => {
  const [h, m] = (hhmm ?? "00:00").split(":").map(Number);
  return { h: (h || 0) % 24, m: (m || 0) % 60 };
};

export const formatHHMM = (h: number, m: number) =>
  `${String(h % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const addHoursHHMM = (hhmm: string, hours: number) => {
  const { h, m } = parseHHMM(hhmm);
  return formatHHMM((h + hours) % 24, m);
};

// NEW: add minutes and also tell you if it rolled into next day
export const addMinutesHHMM = (hhmm: string, minutes: number) => {
  const { h, m } = parseHHMM(hhmm);
  const total = h * 60 + m + (minutes || 0);
  const dayOffset = Math.floor(total / 1440);
  const hh = Math.floor((total % 1440) / 60);
  const mm = total % 60;
  return { hhmm: formatHHMM(hh, mm), dayOffset };
};

// returns whichever is earlier: midnight OR arrival+7h
export const baselineFinishTime = (arrivalHHMM: string) => {
  const plus7 = addHoursHHMM(arrivalHHMM, 7);
  const { h: arrivalH } = parseHHMM(arrivalHHMM);
  if (arrivalH >= 17) return "00:00";
  return plus7;
};