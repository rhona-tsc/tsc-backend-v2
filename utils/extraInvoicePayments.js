const round = value => Math.round((Number(value) || 0) * 100) / 100;
export const extraLineGross = extra => round(Number(extra.price || 0) * (Number(extra.quantity || 1) || 1));
export function extraPayments(extras = []) {
  return extras.map(extra => ({
    description: String(extra.name || extra.key || 'Extra'),
    amount: round(Math.min(Math.max(0, Number(extra.paidAmount) || 0), Math.max(0, extraLineGross(extra)))),
    paidAt: extra.paidAt || null,
  })).filter(payment => payment.amount > 0);
}
export function extrasWithPaymentFraction(extras = [], paid = false) {
  return extras.flatMap(extra => {
    const gross = extraLineGross(extra);
    if (gross <= 0) return paid ? [] : [extra];
    const received = Math.min(Math.max(0, Number(extra.paidAmount) || 0), gross);
    const fraction = (paid ? received : gross - received) / gross;
    if (!fraction) return [];
    return [{ ...extra, price: round(gross * fraction), quantity: 1,
      passThroughGross: round(Number(extra.passThroughGross || 0) * fraction),
      managementGross: round(Number(extra.managementGross || 0) * fraction), paidAmount: 0 }];
  });
}
export function hasFullExtrasPayment(row) {
  return Boolean(row.extrasPaid || row.extrasStatus === 'paid' || row.payments?.extrasPaymentReceived || row.payments?.extrasInvoicePaid);
}
export function partialExtrasReceiptRow(row, extras) {
  if (hasFullExtrasPayment(row)) return row;
  const payments = extraPayments(extras);
  if (!payments.length) return null;
  const dates = payments.map(payment => payment.paidAt).filter(Boolean).map(value => new Date(value)).filter(date => !Number.isNaN(+date));
  const paidAt = dates.length ? new Date(Math.max(...dates)) : row.extrasPaidAt;
  return { ...row, extras: extrasWithPaymentFraction(extras, true), extrasPaidAt: paidAt,
    bookingDetails: { ...row.bookingDetails, extras: extrasWithPaymentFraction(extras, true) }, payments: { ...row.payments, extrasPaidAt: paidAt } };
}
