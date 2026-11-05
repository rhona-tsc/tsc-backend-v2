import test from 'node:test';
import assert from 'node:assert/strict';
import Booking from '../models/bookingModel.js';
import { applyBookingPatch } from '../routes/bookingBoardRoutes.js';

const hydrated = (extra = {}) => Booking.hydrate({ _id: '69862b2cc745ef576f1c7713', bookingId: '261128-MEISSNER-66844', amount: 0, payment: true, balancePaid: false, totals: { fullAmount: 2972, depositAmount: 980.76, chargedAmount: 980.76, chargeMode: 'deposit' }, ...extra });
const noDatabaseSave = doc => { doc.save = async () => doc; return doc; };

test('existing totals are accessible on hydrated bookings rather than being mistaken for a zero-value booking', async () => {
  const doc = noDatabaseSave(hydrated());
  assert.equal(doc.totals.fullAmount, 2972); assert.equal(doc.totals.chargedAmount, 980.76);
  await applyBookingPatch(doc, { arrivalTime: '17:30' });
  assert.equal(doc.balancePaid, false); assert.equal(doc.balanceAmountPence, 199124);
  assert.equal(doc.totals.remainingAmount, 1991.24); assert.equal(doc.totals.outstandingBalance, 1991.24);
  assert.equal(doc.totals.depositAmount, 980.76);
});
test('new bookings persist totals and nested total changes are tracked without a database', () => {
  const doc = new Booking({ bookingId: 'TEST', totals: { fullAmount: 2972, depositAmount: 980.76, chargedAmount: 980.76, currency: 'GBP', futurePricingMetadata: 'retain' } });
  assert.equal(doc.toObject().totals.fullAmount, 2972); assert.equal(doc.toObject().totals.futurePricingMetadata, 'retain');
  const existing = hydrated(); existing.totals.fullAmount = 3389;
  assert.equal(existing.isModified('totals.fullAmount'), true); assert.equal(existing.toObject().totals.fullAmount, 3389);
});
test('missing totals are not defaulted to zero or marked as paid during an unrelated edit', async () => {
  const doc = noDatabaseSave(hydrated({ totals: undefined })); assert.equal(doc.totals, undefined);
  await applyBookingPatch(doc, { notes: 'Updated venue note' }); assert.equal(doc.balancePaid, false);
});
test('a genuine later fee change uses the full updated total once and keeps the deposit', async () => {
  const doc = noDatabaseSave(hydrated());
  await applyBookingPatch(doc, { totals: { bookingTotal: 2972, fullAmount: 3389, depositAmount: 980.76 } });
  assert.equal(doc.totals.fullAmount, 3389); assert.equal(doc.totals.chargedAmount, 980.76); assert.equal(doc.balanceAmountPence, 240824); assert.equal(doc.balancePaid, false);
});
test('confirmed full payments and existing bank settlements survive unrelated edits', async () => {
  for (const doc of [hydrated({ totals: { fullAmount: 2972, chargedAmount: 2972 } }), hydrated({ balancePaid: true, balanceStatus: 'paid' })]) {
    noDatabaseSave(doc); await applyBookingPatch(doc, { notes: 'Updated note' }); assert.equal(doc.balancePaid, true); assert.equal(doc.balanceAmountPence, 0);
  }
});
test('a partial total edit cannot zero the contract price or discard received payments', async () => {
  const doc = noDatabaseSave(hydrated());
  await applyBookingPatch(doc, { totals: { depositAmount: 980.76 } });
  assert.equal(doc.totals.fullAmount, 2972); assert.equal(doc.totals.chargedAmount, 980.76); assert.equal(doc.balanceAmountPence, 199124); assert.equal(doc.balancePaid, false);
});
