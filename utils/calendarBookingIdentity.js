const clean = (value = "") => String(value || "").trim();

export const extractBookingRefFromCalendarEvent = (event = {}) => {
  const privateRef = clean(event?.extendedProperties?.private?.bookingRef);
  if (privateRef) return privateRef;

  const description = clean(event?.description);
  return clean(
    description.match(/(?:Booking\s+Reference|Booking\s+Ref)\s*:\s*([^\n\r]+)/i)?.[1],
  );
};

export const isVocalRole = (value = "") =>
  /\b(?:vocal(?:ist)?|singer)\b/i.test(clean(value));

export const activeAllocationStatus = (value = "") =>
  ["accepted", "confirmed"].includes(clean(value).toLowerCase());

export const isOnlyActiveVocalist = ({ assignment, assignments = [] } = {}) => {
  const role = assignment?.role || assignment?.instrument || "";
  if (!isVocalRole(role)) return false;

  const seen = new Set();
  const activeVocalists = assignments.filter((entry) => {
    const identity = clean(
      entry?.roleSlotId || entry?.musicianId || entry?.email || entry?.name,
    ).toLowerCase();
    if (identity && seen.has(identity)) return false;
    if (identity) seen.add(identity);
    return (
      activeAllocationStatus(entry?.status) &&
      isVocalRole(entry?.role || entry?.instrument)
    );
  });

  return activeVocalists.length <= 1;
};
