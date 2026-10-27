import crypto from "node:crypto";

const clean = (value) => String(value || "").trim();

export const isWeddingBooking = (row = {}) =>
  /wedding/i.test(clean(row.eventType || row.bookingDetails?.eventType));

export const buildWeddingReferralCode = (row = {}) => {
  if (!isWeddingBooking(row)) return "";
  const identity = clean(
    row._id || row.bookingRef || row.bookingId || row.sessionId || row.clientEmail,
  );
  if (!identity) return "";
  const suffix = crypto
    .createHash("sha256")
    .update(`tsc-wedding-referral:${identity}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `TSC-WED-${suffix}`;
};
