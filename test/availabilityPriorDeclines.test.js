import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityPhone, availabilityPersonMatches, isExplicitAvailabilityDecline,
  findPriorAvailabilityDecline } from '../services/availabilityPriorDeclines.js';

const person = { musicianId: '692ebcf6e7dfeac14dc2168b', phone: '+447000000001',
  dateISO: '2026-12-05', formattedAddress: 'New venue, London WC1H 9JP' };
const decline = patch => ({ _id: 'old-request', musicianId: person.musicianId,
  phone: person.phone, dateISO: person.dateISO, reply: 'unavailable',
  messageSidOut: 'SIMULATED', enquiryId: 'another-enquiry', actId: 'another-band',
  formattedAddress: 'A different venue, Bristol BS1 1AA', ...patch });
const query = value => ({ select() { return this; }, lean: async () => value });

test('a whole-date decline follows the musician across bands, enquiries and legacy v2 values', () => {
  for (const v2 of [true, false, undefined]) {
    assert.equal(isExplicitAvailabilityDecline(decline({ v2 }), person), true);
  }
  assert.equal(isExplicitAvailabilityDecline(decline({ dateISO: '2026-12-06' }), person), false);
});

test('canonical identity works after a phone change and phone-only legacy records normalize safely', () => {
  assert.equal(availabilityPersonMatches(decline({ phone: '+447000000099' }), person), true);
  for (const phone of ['07000 000001', '447000000001', '00447000000001',
    'whatsapp:+44 (7000) 000-001']) {
    assert.equal(availabilityPhone(phone), person.phone);
    assert.equal(availabilityPersonMatches(decline({ musicianId: null, phone }), person), true);
  }
  assert.equal(availabilityPersonMatches(decline({ musicianId: 'another-person' }), person), false);
  assert.equal(availabilityPersonMatches(decline({ musicianId: null, phone: '+447000000002',
    musicianName: 'Richard Marshall' }), person), false);
});

test('location-only declines do not become a whole-date ban', () => {
  assert.equal(isExplicitAvailabilityDecline(decline({ reply: 'no' }), person), false);
  assert.equal(isExplicitAvailabilityDecline(decline({ reply: 'no',
    formattedAddress: 'New venue, London WC1H 9JP, UK' }), person), true);
  assert.equal(isExplicitAvailabilityDecline(decline({ reply: 'no',
    formattedAddress: 'New venue, WC1H9JP' }), person), true);
  assert.equal(isExplicitAvailabilityDecline(decline({ reply: 'no', formattedAddress: 'TBC' }),
    { ...person, formattedAddress: 'TBC' }), false);
});

test('calendar declines, read receipts, unanswered requests and synthetic unavailability are not musician replies', () => {
  for (const patch of [{ reply: null, calendarStatus: 'declined' },
    { reply: null, deliveryStatus: 'read' }, { reply: 'yes' },
    { messageSidOut: null, repliedAt: new Date() }]) {
    assert.equal(isExplicitAvailabilityDecline(decline(patch), person), false);
  }
  assert.equal(isExplicitAvailabilityDecline(decline({ messageSidOut: null,
    inbound: { sid: 'SIMULATED-INBOUND' } }), person), true);
});

test('a corrected same-request YES wins over its old NO history', () => {
  assert.equal(isExplicitAvailabilityDecline(decline({ reply: 'yes',
    replyHistory: [{ reply: 'unavailable', source: 'whatsapp' }] }), person), false);
});

test('lookup queries exact date and identity without act/enquiry/v2 scoping; includes booking-role declines', async () => {
  const filters = [];
  const models = {
    Availability: { find(filter) { filters.push(filter); return query([]); } },
    EnquiryMessage: { find(filter) { filters.push(filter); return query([
      decline({ messageSidOut: null, messageSid: 'SIMULATED-BOOKING', meta: { MetaISODate: person.dateISO } }),
    ]); } },
  };
  assert.equal((await findPriorAvailabilityDecline(person, models))._id, 'old-request');
  for (const filter of filters) {
    assert.equal(filter.actId, undefined); assert.equal(filter.enquiryId, undefined);
    assert.equal(filter.v2, undefined); assert.equal(filter.lineupId, undefined);
    assert.equal(JSON.stringify(filter).includes('2026-12-05'), true);
  }
  const regex = filters[0].$and[0].$or.find(part => part.phone).phone;
  for (const value of ['+447000000001', 'whatsapp:07000 000001', '00447000000001',
    '44 (7000) 000-001']) assert.equal(regex.test(value), true, value);
  for (const value of ['+4470000000019', '+447000000002', 'Richard']) assert.equal(regex.test(value), false, value);
});

test('missing identity/date or database failure holds rather than contacting a musician', async () => {
  await assert.rejects(findPriorAvailabilityDecline({ ...person, dateISO: '' }));
  await assert.rejects(findPriorAvailabilityDecline({ ...person, dateISO: '2026-02-30' }));
  await assert.rejects(findPriorAvailabilityDecline({ ...person, musicianId: '', phone: '' }));
  const broken = { find() { throw new Error('database unavailable'); } };
  await assert.rejects(findPriorAvailabilityDecline(person,
    { Availability: broken, EnquiryMessage: broken }), /database unavailable/);
});
