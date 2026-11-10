import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAttribution } from '../utils/marketingAttribution.js';
import { recordWebsiteEnquiry, linkBookingEnquiries } from '../services/websiteEnquiryService.js';
import Enquiry from '../models/enquiryBoardItem.js';
import Booking from '../models/bookingModel.js';
const now = new Date('2026-11-10T14:00:00Z');
const touch = { channel: 'Google Ads', source: 'google', medium: 'cpc', capturedAt: '2026-11-10T12:00:00Z', campaignId: '123', adGroupId: '456', keyword: 'motown wedding band', gclid: 'opaque-click', landingPath: '/acts/', referrerHost: 'google.com' };
const attribution = { version: 1, consentGranted: true, firstTouch: touch, lastTouch: touch };
test('server validation rejects expired/future touches and strips identifiers when advertising consent is absent', () => {
  const denied = normalizeAttribution({ ...attribution, consentGranted: false }, now);
  assert.equal(denied.firstTouch.channel, 'Google Ads');
  assert.equal(denied.lastTouch.gclid, undefined); assert.equal(denied.lastTouch.keyword, undefined);
  const invalid = normalizeAttribution({ ...attribution, firstTouch: { ...touch, capturedAt: '2028-01-01' }, lastTouch: { ...touch, capturedAt: '2025-01-01' } }, now);
  assert.equal(invalid, undefined);
  const clean = normalizeAttribution({ ...attribution, lastTouch: { ...touch, keyword: 'private@example.com', landingPath: '/booking/private', gclid: 'x@y' } }, now);
  assert.equal(clean.lastTouch.keyword, ''); assert.equal(clean.lastTouch.landingPath, undefined); assert.equal(clean.lastTouch.gclid, undefined);
});
test('all bands for the same customer event inherit the saved source and opaque conversion receipt', async () => {
  const receipts = new Map(), rows = new Map();
  const options = { now,
    ReceiptModel: { findOneAndUpdate: async (q,u) => { if (!receipts.has(q._id)) receipts.set(q._id,u.$setOnInsert); return receipts.get(q._id); } },
    EnquiryModel: { findOneAndUpdate: async (q,u) => { if (!rows.has(q.websiteKey)) rows.set(q.websiteKey,u.$setOnInsert); return rows.get(q.websiteKey); } },
    ActModel: { findById: () => ({ select: () => ({ lean: async () => ({ name: 'Example', lineups: [{ _id: 'lineup1' }] }) }) }) },
  };
  const payload = { clientEmail: 'customer@example.com', actId: 'act1', lineupId: 'lineup1', dateISO: '2027-06-05', formattedAddress: 'Example venue SW1A 1AA', attribution };
  const first = await recordWebsiteEnquiry({ ...payload }, options);
  const second = await recordWebsiteEnquiry({ ...payload, actId: 'act2', attribution: undefined }, options);
  assert.equal(first.measurement.id, second.measurement.id); assert.equal(receipts.size, 1);
  assert.equal(rows.size, 2);
  for (const row of rows.values()) { assert.equal(row.marketingSource,'Google Ads'); assert.equal(row.attribution.lastTouch.campaignId,'123'); }
  assert.doesNotMatch(JSON.stringify(first.measurement), /opaque-click|google|customer/);
  const row = new Enquiry([...rows.values()][0]); assert.equal(row.attribution.lastTouch.gclid, 'opaque-click');
});
test('booking links are resolved from matching server records and preserve the enquiry source across a direct return', async () => {
  const queries = [];
  const model = { findOne: q => ({ select: () => ({ lean: async () => { queries.push(q); return { enquiryRef: 'WEB-opaque', measurementId: 'enquiry:opaque', attribution }; } }) }) };
  const links = await linkBookingEnquiries({ email: 'customer@example.com', date: '2027-06-05', address: 'Example SW1A 1AA', actsSummary: [{ actId: 'act1', lineupId: 'lineup1' }], attribution: { ...attribution, lastTouch: { ...touch, channel: 'Direct / unknown' } } }, { EnquiryModel: model, now });
  assert.equal(queries.length,1); assert.match(queries[0].websiteKey, /:act1:lineup1$/);
  assert.deepEqual(links.linkedEnquiryRefs, ['WEB-opaque']); assert.equal(links.attribution.lastTouch.channel,'Google Ads');
  const booking = new Booking({ bookingId: 'test', ...links });
  assert.equal(booking.attribution.lastTouch.gclid, 'opaque-click'); assert.equal(booking.linkedMeasurementIds[0], 'enquiry:opaque');
});
