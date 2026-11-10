// Only Stripe-retrieved or signature-verified sessions may enter this function.
export function verifiedInitialPayment(session, booking) {
  const ref = String(booking?.bookingId || "");
  const amount = Math.round(Number(booking?.amount) * 100);
  const currency = String(booking?.accounting?.currency || booking?.currency || "GBP").toLowerCase();
  const discount = session?.total_details?.amount_discount || 0;
  const subtotal = session?.amount_subtotal ?? session?.amount_total;
  const adjustments = (session?.total_details?.amount_tax || 0) + (session?.total_details?.amount_shipping || 0);
  return Boolean(ref && session?.metadata?.booking_ref === ref &&
    session?.id === booking?.sessionId && session?.mode === "payment" &&
    session?.status === "complete" && session?.payment_status === "paid" &&
    !["balance", "parking"].includes(session?.metadata?.category) &&
    !["balance", "parking"].includes(session?.metadata?.payment_stage) &&
    Number.isSafeInteger(amount) && amount > 0 && subtotal === amount && Number.isSafeInteger(discount) && discount >= 0 &&
    Number.isSafeInteger(session.amount_total) && session.amount_total > 0 && session.amount_total === amount - discount + adjustments &&
    session?.currency === currency);
}

export function paidBookingMeasurement(session, booking) {
  if (!verifiedInitialPayment(session, booking) || session.livemode !== true) return null;
  // Value means the payment collected at initial checkout, not the band's total fee
  // or profit. Balance payments never create another booking conversion.
  return { kind: "booking", id: `booking:${booking._id}`,
    value: session.amount_total / 100, currency: session.currency.toUpperCase() };
}
