const INTERNAL_BOOKING_SOURCE_PATTERN =
  /^(direct|tsc|tsc direct|the supreme collective|bamboo|bmm)$/i;

export const isExternalAgencyBooking = (row = {}) => {
  const source = String(row.agent || row.source || "").trim();
  return Boolean(source) && !INTERNAL_BOOKING_SOURCE_PATTERN.test(source);
};

export const getDepositPaidToInvoiceCompany = (row = {}) => {
  if (isExternalAgencyBooking(row)) return 0;

  const chargedAmount = Number(row?.payments?.depositChargedAmount || 0);
  return Number.isFinite(chargedAmount) ? Math.max(chargedAmount, 0) : 0;
};
