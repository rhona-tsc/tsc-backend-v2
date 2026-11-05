import Booking from "../models/bookingModel.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import { buildEventSheetUrl } from "../utils/publicSiteUrl.js";

const pence = (value) => Math.round(Number(value || 0) * 100);
export const isBalanceCheckout = (session) =>
  [session?.metadata?.category, session?.metadata?.payment_stage, session?.metadata?.paymentStage]
    .includes("balance");
export const balanceIsPaid = (booking) => booking.balancePaid === true ||
  booking.totals?.balancePaid === true || booking.balanceStatus === "paid";

export const getBalanceAmounts = (booking) => {
  const full = pence(booking.totals?.fullAmount ?? booking.fee);
  const charged = booking.totals?.chargedAmount == null ? NaN : pence(booking.totals.chargedAmount);
  if (!Number.isSafeInteger(full) || !Number.isSafeInteger(charged) || full <= 0 || charged < 0) {
    throw new Error("The booking fee or payments need checking before payment.");
  }
  return { full, charged, remaining: Math.max(0, full - charged),
    currency: String(booking.totals?.currency || booking.currency || "GBP").toLowerCase() };
};

const belongsToBooking = (session, booking) =>
  isBalanceCheckout(session) && (
    session.metadata?.bookingMongoId === String(booking._id) ||
    (booking.bookingId && session.metadata?.booking_ref === booking.bookingId) ||
    (booking.bookingId && session.metadata?.bookingId === booking.bookingId)
  );

// Called only with a signature-verified webhook or a session retrieved from
// Stripe. The success URL and the client's proposed amount are never receipts.
export const fulfilBalanceCheckout = async (session, { BookingModel = Booking, BoardModel = BookingBoardItem } = {}) => {
  if (!isBalanceCheckout(session) || session.payment_status !== "paid" || session.status !== "complete") return false;
  const booking = await BookingModel.findOne({ balanceInvoiceId: session.id });
  if (!booking || !belongsToBooking(session, booking)) throw new Error("Unmatched balance payment.");
  const { full, remaining, currency } = getBalanceAmounts(booking);
  const alreadyApplied = booking.balancePaymentSessionId === session.id;
  if (session.currency !== currency || !Number.isSafeInteger(session.amount_total) ||
      (!alreadyApplied && (balanceIsPaid(booking) || remaining <= 0 || session.amount_total !== remaining))) {
    throw new Error("Balance payment does not match the outstanding booking amount.");
  }
  const paidAt = booking.balancePaidAt || new Date();
  if (!alreadyApplied) {
    // A conditional update makes duplicate/concurrent webhook deliveries safe.
    const result = await BookingModel.updateOne({
      _id: booking._id,
      balanceInvoiceId: session.id,
      balancePaid: { $ne: true },
      balanceStatus: booking.balanceStatus,
      "totals.balancePaid": { $ne: true },
      fee: booking.fee,
      "totals.currency": booking.totals?.currency,
      balancePaymentSessionId: { $ne: session.id },
      "totals.fullAmount": booking.totals?.fullAmount,
      "totals.chargedAmount": booking.totals?.chargedAmount,
    }, { $set: {
      "totals.chargedAmount": full / 100,
      "totals.remainingAmount": 0,
      "totals.outstandingBalance": 0,
      "totals.balancePaid": true,
      balanceAmountPence: 0, balancePaid: true, balanceStatus: "paid", paymentStatus: "paid",
      balancePaymentSessionId: session.id,
      balancePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      balancePaidAt: paidAt,
    } });
    if (!result.matchedCount) {
      const latest = await BookingModel.findOne({ _id: booking._id });
      if (latest?.balancePaymentSessionId !== session.id) throw new Error("Booking changed while processing balance payment.");
    }
  }
  // Retry this mirror even if the core payment was already recorded. Preserve
  // the original deposit IDs and accounting allocation on both records.
  await BoardModel.updateMany({ $or: [
    { bookingRef: booking.bookingId }, { bookingId: booking._id }, { sourceBookingId: booking._id },
  ] }, { $set: {
    balancePaid: true, balanceStatus: "paid", "payments.balancePaymentReceived": true,
    "payments.invoicePaid": true, "payments.paidAt": paidAt,
    "payments.balanceInvoiceId": session.id,
  } });
  return true;
};

export const createOrReuseBalanceCheckout = async (booking, stripeClient, { fulfil = fulfilBalanceCheckout } = {}) => {
  if (balanceIsPaid(booking)) return { paid: true };
  const { full, charged, remaining, currency } = getBalanceAmounts(booking);
  if (remaining <= 0) return { paid: true };
  const previousId = String(booking.balanceInvoiceId || "");
  if (previousId && !previousId.startsWith("cs_")) {
    // A separately issued Stripe invoice must not be duplicated by Checkout.
    throw new Error("An existing invoice needs checking before creating a new payment link.");
  }
  if (previousId.startsWith("cs_")) {
    const previous = await stripeClient.checkout.sessions.retrieve(previousId);
    if (!belongsToBooking(previous, booking)) throw new Error("The existing payment link needs checking.");
    if (previous.payment_status === "paid") {
      await fulfil(previous);
      return { paid: true };
    }
    if (previous.status === "open") {
      if (previous.currency === currency && previous.amount_total === remaining && previous.url) {
        return { paid: false, url: previous.url };
      }
      // Prevent a superseded link from collecting a different balance later.
      await stripeClient.checkout.sessions.expire(previousId);
    } else if (previous.status !== "expired") {
      throw new Error("A payment is being processed. Please check again shortly.");
    }
  }
  const ref = booking.bookingId || String(booking._id);
  const metadata = {
    category: "balance", payment_stage: "balance", paymentStage: "balance",
    bookingId: ref, booking_ref: ref, bookingMongoId: String(booking._id),
    remainingPence: String(remaining), fullAmount: String(full / 100), chargedAmount: String(charged / 100),
  };
  const eventSheetUrl = buildEventSheetUrl(ref);
  const session = await stripeClient.checkout.sessions.create({
    mode: "payment", payment_method_types: ["card"],
    line_items: [{ price_data: { currency, product_data: { name: `Outstanding balance for ${ref}` }, unit_amount: remaining }, quantity: 1 }],
    success_url: `${eventSheetUrl}?balancePaid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${eventSheetUrl}?balanceCanceled=1`,
    metadata, payment_intent_data: { metadata },
  }, { idempotencyKey: `booking-balance-${booking._id}-${currency}-${full}-${charged}-${previousId || "first"}` });
  booking.balanceAmountPence = remaining;
  booking.balanceInvoiceUrl = session.url;
  booking.balanceInvoiceId = session.id;
  booking.balanceStatus = "sent";
  await booking.save();
  return { paid: false, url: session.url };
};
