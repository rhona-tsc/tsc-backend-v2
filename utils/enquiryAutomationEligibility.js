const DEFAULT_MAX_AGE_HOURS = 7 * 24;

const clean = (value) => String(value || "").trim();

const maxAgeHours = () => {
  const configured = Number(process.env.AUTOMATED_ENQUIRY_MAX_AGE_HOURS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_AGE_HOURS;
};

export const eventDateIsCurrentOrFuture = (value, now = Date.now()) => {
  const isoDay = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  return isoDay >= today;
};

const eligibleWithinHours = (row, now, ageHours) => {
  const actName = clean(row?.actName);
  if (!actName || /^test\b/i.test(actName)) return false;
  if (!eventDateIsCurrentOrFuture(row?.dateISO || row?.date, now)) return false;

  const startedAt = new Date(
    row?.outboundSentAt || row?.createdAt || 0,
  ).getTime();
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now) {
    return false;
  }

  return now - startedAt <= ageHours * 3_600_000;
};

export const automatedEnquiryEligible = (row, now = Date.now()) =>
  eligibleWithinHours(row, now, maxAgeHours());

// Client follow-ups run two days apart. The Day 6 send can fall just beyond
// the seven-day WhatsApp safety window because client emails are checked only
// during business hours. A separate 14-day ceiling keeps the intended sequence
// eligible without allowing genuinely old enquiry records back into automation.
export const automatedEnquiryFollowupEligible = (row, now = Date.now()) =>
  eligibleWithinHours(row, now, Math.max(maxAgeHours(), 14 * 24));

export const validAvailabilityRecipientName = (value) => {
  const name = clean(value).split(/\s+/)[0];
  return Boolean(name) && !/^(?:tbc|unknown|there|n\/?a)$/i.test(name);
};

