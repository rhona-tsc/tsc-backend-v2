import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedInitialPayment, paidBookingMeasurement } from '../utils/bookingMeasurement.js';
import { websiteEnquiryIdentity, recordWebsiteEnquiry } from '../services/websiteEnquiryService.js';
import Booking from '../models/bookingModel.js';
const booking = { _id: '6abc12345678901234567890a', bookingId: 'private-client-ref', sessionId: 'cs_live_receipt', amount: 100, accounting: { currency: 'GBP' } };
const session = { id: booking.sessionId, metadata: { booking_ref: booking.bookingId }, mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 10000, currency: 'gbp', livemode: true };
test('only a verified paid initial checkout produces a booking receipt, without personal references', () => {
  assert.equal(verifiedInitialPayment(session, booking), true);
  assert.deepEqual(paidBookingMeasurement(session, booking), { kind: 'booking', id: `booking:${booking._id}`, value: 100, currency: 'GBP' });
  for (const patch of [{ payment_status: 'unpaid' }, { status: 'open' }, { id: 'other' }, { amount_total: 1 }, { currency: 'usd' }, { metadata: { booking_ref: 'other' } }, { metadata: { ...session.metadata, category: 'balance' } }, { metadata: { ...session.metadata, category: 'parking' } }]) {
    assert.equal(verifiedInitialPayment({ ...session, ...patch }, booking), false);
    assert.equal(paidBookingMeasurement({ ...session, ...patch }, booking), null);
  }
  assert.equal(paidBookingMeasurement({ ...session, livemode: false }, booking), null);
});
test('Stripe-verified promotion discounts use actual collected value and cannot change the original subtotal', () => {
  const discounted = { ...session, amount_subtotal: 10000, amount_total: 8000, total_details: { amount_discount: 2000 } };
  assert.equal(paidBookingMeasurement(discounted, booking).value, 80);
  assert.equal(paidBookingMeasurement({ ...discounted, amount_subtotal: 2000 }, booking), null);
});
const payload = { actId: '6abc12345678901234567890a', lineupId: '6abc12345678901234567890b', clientEmail: 'customer@example.com', dateISO: '2027-06-05', formattedAddress: 'Venue, London, SW1A 1AA' };
const now = new Date('2026-11-10T12:00:00Z');
test('a genuine enquiry needs contact, act, future date and real venue; repeat bands for the same event share identity', () => {
  const first = websiteEnquiryIdentity(payload, now);
  assert.ok(first);
  assert.equal(websiteEnquiryIdentity({ ...payload, actId: 'different', formattedAddress: 'Venue name, sw1a1aa' }, now).id, first.id);
  for (const patch of [{ clientEmail: '' }, { dateISO: '2026-01-01' }, { dateISO: '2027-02-30' }, { formattedAddress: 'TBC' }, { actId: '' }]) assert.equal(websiteEnquiryIdentity({ ...payload, ...patch }, now), null);
});
test('saved enquiries use opaque random receipts shared across bands, and failed saves never return success', async () => {
  const receipts = new Map(); const enquiries = new Map();
  const ReceiptModel = { findOneAndUpdate: async (filter, update) => {
    if (!receipts.has(filter._id)) receipts.set(filter._id, update.$setOnInsert);
    return receipts.get(filter._id);
  } };
  const EnquiryModel = { findOneAndUpdate: async (filter, update) => {
    if (!enquiries.has(filter.websiteKey)) enquiries.set(filter.websiteKey, update.$setOnInsert);
    return enquiries.get(filter.websiteKey);
  } };
  const options = { ReceiptModel, EnquiryModel, now, ActModel: { findById: () => ({ select: () => ({ lean: async () => ({ name: 'Example band', lineups: [{ _id: payload.lineupId, bandMembers: [] }] }) }) }) } };
  const first = await recordWebsiteEnquiry(payload, options);
  const second = await recordWebsiteEnquiry({ ...payload, actId: '6abc12345678901234567890c' }, options);
  assert.equal(first.measurement.id, second.measurement.id);
  assert.match(first.measurement.id, /^enquiry:[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(first.measurement), /customer|2027|SW1A/);
  await assert.rejects(recordWebsiteEnquiry(payload, { ...options, EnquiryModel: { findOneAndUpdate: async () => { throw Error('save failed'); } } }), /save failed/);
});
test('website booking details and all selected vocalist role snapshots survive schema casting', () => {
  const doc = new Booking({ bookingId: 'test', date: '2027-06-05', venueAddress: 'Test venue', userAddress: { firstName: 'Test' }, signatureUrl: 'data:image/png;base64,test', checkoutCompleted: true,
    actsSummary: [{ actId: payload.actId, lineupId: payload.lineupId, chosenVocalists: [{ musicianId: payload.actId, name: 'Alex', slotIndex: 0, role: 'Lead Vocal', isDeputy: true }] }] });
  assert.equal(doc.userAddress.firstName, 'Test'); assert.equal(doc.venueAddress, 'Test venue'); assert.equal(doc.checkoutCompleted, true); assert.ok(doc.date instanceof Date);
  assert.equal(doc.actsSummary[0].chosenVocalists[0].role, 'Lead Vocal');
  assert.equal(doc.actsSummary[0].chosenVocalists[0].name, 'Alex');
});
