const normalise = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const isEncoreBooking = (row = {}) => [row.agent, row.bookingSource, row.source,
  row.importMetadata?.agent, row.importMetadata?.source].some(value => ['encore', 'encorepdf'].includes(normalise(value)));
const amount = (...values) => {
  for (const value of values) {
    if (value == null || value === '' || typeof value === 'boolean') continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number * 100) / 100;
  }
  return null;
};
export function resolveEncoreSettlement(row = {}) {
  const extras = row.extras ?? row.bookingDetails?.extras ?? row.actsSummary?.[0]?.selectedExtras ?? [];
  const addOnsPostBooking = Math.round(extras.filter(extra => extra.includeOnExtrasInvoice !== false)
    .reduce((sum, extra) => sum + (amount(extra.price) || 0) * Math.max(0, Number(extra.quantity ?? 1) || 0), 0) * 100) / 100;
  const bookingTotal = amount(row.originalBookingTotal, row.importMetadata?.encore?.earnings);
  // Legacy records without verified earnings must be reviewed, not silently
  // converted from Encore's client-facing quote or inferred from a deposit.
  if (bookingTotal == null) return null;
  const extrasPaid = row.extrasPaid === true || String(row.extrasStatus || '').toLowerCase() === 'paid'
    || row.payments?.extrasPaymentReceived === true || row.payments?.extrasInvoicePaid === true;
  const remainingAmount = extrasPaid ? 0 : addOnsPostBooking;
  return { bookingTotal, contractTotal: bookingTotal, addOnsPostBooking,
    fullAmount: Math.round((bookingTotal + addOnsPostBooking) * 100) / 100,
    depositAmount: 0, chargedAmount: extrasPaid ? addOnsPostBooking : 0,
    remainingAmount, outstandingBalance: remainingAmount,
    paymentArrangement: { provider: 'Encore', arrangedAmount: bookingTotal, extrasPaid } };
}
