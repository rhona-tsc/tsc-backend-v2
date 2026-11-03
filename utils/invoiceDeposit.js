const INTERNAL_BOOKING_SOURCE_PATTERN =
  /^(direct|tsc|tsc direct|the supreme collective|bamboo|bmm)$/i;

export const isExternalAgencyBooking = (row = {}) => {
  const source = String(row.agent || row.source || "").trim();
  return Boolean(source) && !INTERNAL_BOOKING_SOURCE_PATTERN.test(source);
};

export const getDepositPaidToInvoiceCompany = (row = {}) => {
  if (isExternalAgencyBooking(row)) return 0;

  const paidDepositInvoice = row?.depositInvoice || {};
  const depositInvoiceIsPaid =
    String(paidDepositInvoice.status || "").toLowerCase() === "paid";
  const paidDepositInvoiceGross = Number(paidDepositInvoice.gross || 0);

  // A paid deposit invoice is the clearest record of what this company
  // actually received. Prefer it to legacy payment fields, which can become
  // stale when a deposit arrangement is changed after the original contract.
  if (
    depositInvoiceIsPaid &&
    Number.isFinite(paidDepositInvoiceGross) &&
    paidDepositInvoiceGross > 0
  ) {
    return paidDepositInvoiceGross;
  }

  const chargedAmount = Number(row?.payments?.depositChargedAmount || 0);
  return Number.isFinite(chargedAmount) ? Math.max(chargedAmount, 0) : 0;
};
