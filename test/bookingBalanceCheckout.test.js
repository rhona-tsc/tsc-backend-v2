import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrReuseBalanceCheckout, fulfilBalanceCheckout, getBalanceAmounts } from '../services/bookingBalancePaymentService.js';

const bookingFixture = () => ({ _id: '69862b2cc745ef576f1c7713', bookingId: '261128-MEISSNER-66844',
  totals: { fullAmount: 2972, chargedAmount: 980.76, currency: 'GBP' },
  balancePaid: false, accounting: { commissionGross: 721.24, passThroughGross: 1270 },
  sessionId: 'cs_live_original_deposit', paymentIntentId: 'pi_original',
  async save() { this.saves = (this.saves || 0) + 1; },
});
const paidSession = (booking) => ({ id: 'cs_test_balance', status: 'complete', payment_status: 'paid',
  amount_total: 199124, currency: 'gbp', payment_intent: 'pi_balance',
  metadata: { category: 'balance', bookingMongoId: String(booking._id), booking_ref: booking.bookingId },
});
const stripeFixture = (existing, failCreate = false) => {
  const calls = { create: [], expire: [] };
  return { calls, checkout: { sessions: {
    retrieve: async () => existing,
    expire: async (id) => { calls.expire.push(id); },
    create: async (...args) => {
      calls.create.push(args);
      if (failCreate) throw new Error('provider unavailable');
      return { id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' };
    },
  } } };
};
test('checkout charges only server-calculated remaining pence, with safe return URL and idempotency', async () => {
  const booking = bookingFixture(), stripe = stripeFixture();
  const result = await createOrReuseBalanceCheckout(booking, stripe);
  const [request, options] = stripe.calls.create[0];
  assert.equal(request.line_items[0].price_data.unit_amount, 199124);
  assert.equal(request.line_items[0].price_data.currency, 'gbp');
  assert.equal(request.allow_promotion_codes, undefined);
  assert.match(request.success_url, /^https:\/\//);
  assert.match(request.success_url, /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.equal(request.payment_intent_data.metadata.payment_stage, 'balance');
  assert.match(options.idempotencyKey, /199124|297200-98076/);
  assert.equal(booking.balanceAmountPence, 199124);
  assert.equal(result.url, booking.balanceInvoiceUrl);
});
test('settled balances never reopen or create another checkout', async () => {
  const booking = bookingFixture(), stripe = stripeFixture(); booking.balancePaid = true;
  assert.deepEqual(await createOrReuseBalanceCheckout(booking, stripe), { paid: true });
  assert.equal(stripe.calls.create.length, 0);
});
test('only a verified open checkout with matching amount, currency and booking is reused', async () => {
  const booking = bookingFixture(); booking.balanceInvoiceId = 'cs_test_balance';
  const session = { ...paidSession(booking), status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/existing' };
  const stripe = stripeFixture(session);
  assert.equal((await createOrReuseBalanceCheckout(booking, stripe)).url, session.url);
  assert.equal(stripe.calls.create.length, 0);
  session.amount_total = 101048;
  await createOrReuseBalanceCheckout(booking, stripe);
  assert.deepEqual(stripe.calls.expire, ['cs_test_balance']);
  assert.equal(stripe.calls.create.length, 1);
});
test('expired checkouts are replaced; unrelated or processing sessions are not', async () => {
  const booking = bookingFixture(); booking.balanceInvoiceId = 'cs_test_balance';
  const expired = { ...paidSession(booking), status: 'expired', payment_status: 'unpaid' };
  assert.ok((await createOrReuseBalanceCheckout(booking, stripeFixture(expired))).url);
  booking.balanceInvoiceId = 'cs_test_balance';
  await assert.rejects(createOrReuseBalanceCheckout(booking, stripeFixture({ ...expired, status: 'complete' })), /being processed/);
  await assert.rejects(createOrReuseBalanceCheckout(booking, stripeFixture({ ...expired, metadata: { category: 'balance', booking_ref: 'other' } })), /needs checking/);
});
test('provider failure leaves saved financial records and the previous link unchanged', async () => {
  const booking = bookingFixture(), before = JSON.stringify(booking);
  await assert.rejects(createOrReuseBalanceCheckout(booking, stripeFixture(null, true)));
  assert.equal(JSON.stringify(booking), before);
});
test('missing charged totals fail closed instead of charging the full fee again', () => {
  assert.throws(() => getBalanceAmounts({ fee: 2972 }), /need checking/);
});
const persistenceFixture = (booking) => {
  let updates = 0, mirrors = 0;
  return { get updates() { return updates; }, get mirrors() { return mirrors; },
    BookingModel: {
      findOne: async () => booking,
      updateOne: async (filter, update) => {
        assert.equal(filter.balanceInvoiceId, 'cs_test_balance');
        assert.equal(filter['totals.chargedAmount'], 980.76);
        assert.equal(filter['totals.fullAmount'], 2972);
        updates++;
        for (const [path, value] of Object.entries(update.$set)) {
          if (path.startsWith('totals.')) booking.totals[path.slice(7)] = value;
          else booking[path] = value;
        }
        return { matchedCount: 1 };
      },
    }, BoardModel: { updateMany: async (filter, update) => {
      mirrors++;
      assert.ok(filter.$or.some((item) => item.bookingRef === booking.bookingId));
      assert.equal(update.$set['payments.balancePaymentReceived'], true);
      assert.equal(update.$set.accounting, undefined);
    } },
  };
};
test('verified balance payment updates core and board once without overwriting deposit IDs or accounting', async () => {
  const booking = bookingFixture(); booking.balanceInvoiceId = 'cs_test_balance';
  const originalAccounting = JSON.stringify(booking.accounting), db = persistenceFixture(booking), session = paidSession(booking);
  assert.equal(await fulfilBalanceCheckout(session, db), true);
  assert.equal(await fulfilBalanceCheckout(session, db), true);
  assert.equal(db.updates, 1);
  assert.equal(db.mirrors, 2); // A retry also repairs a failed board mirror.
  assert.equal(booking.totals.chargedAmount, 2972);
  assert.equal(booking.totals.remainingAmount, 0);
  assert.equal(booking.balancePaid, true);
  assert.equal(booking.balancePaymentSessionId, session.id);
  assert.equal(booking.paymentIntentId, 'pi_original');
  assert.equal(booking.sessionId, 'cs_live_original_deposit');
  assert.equal(JSON.stringify(booking.accounting), originalAccounting);
});
test('unpaid success redirects, wrong amounts, currencies, and unrelated booking metadata cannot settle a balance', async () => {
  for (const override of [{ payment_status: 'unpaid' }, { amount_total: 101048 }, { currency: 'usd' }, { metadata: { category: 'balance', booking_ref: 'other' } }]) {
    const booking = bookingFixture(); booking.balanceInvoiceId = 'cs_test_balance';
    const db = persistenceFixture(booking), session = { ...paidSession(booking), ...override };
    if (override.payment_status) assert.equal(await fulfilBalanceCheckout(session, db), false);
    else await assert.rejects(fulfilBalanceCheckout(session, db));
    assert.equal(db.updates, 0);
    assert.equal(db.mirrors, 0);
  }
});
test('paid existing checkout is reconciled before returning already-paid', async () => {
  const booking = bookingFixture(); booking.balanceInvoiceId = 'cs_test_balance';
  let fulfilled = false;
  assert.deepEqual(await createOrReuseBalanceCheckout(booking, stripeFixture(paidSession(booking)), {
    fulfil: async () => { fulfilled = true; },
  }), { paid: true });
  assert.equal(fulfilled, true);
});
