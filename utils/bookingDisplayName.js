const cleanText = (value) => String(value || "").trim();

/**
 * The Booking Board's Act field is the contracted/booked act name.
 * Public/TSC names are only fallbacks for older records that do not have it.
 */
export const resolveBookedActName = ({ board, booking } = {}) =>
  cleanText(board?.actName) ||
  cleanText(booking?.actName) ||
  cleanText(board?.actTscName) ||
  cleanText(booking?.actTscName) ||
  cleanText(booking?.tscName);

