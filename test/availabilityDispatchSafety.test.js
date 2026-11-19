import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAvailabilityDispatch as plan, assertApprovedAvailabilityRecipient,
  approvedAvailabilityFee, availabilityEnquiryDuties, assertAvailabilityContactAllowed,
  validateAvailabilityDispatchRecipients, priorAvailabilityDeclines } from '../services/availabilityDispatchSafety.js';

const kedesha = { _id: 'roster-k', musicianId: '6943ec66d9fa061f2fcd3fb7', firstName: 'Kedesha', lastName: 'Charles',
  instrument: 'Lead Female Vocal', email: 'k@example.test', phoneNumber: '+447000000001', fee: 355 };
const emma = { _id: 'roster-e', musicianId: '6920b022cddfe7353a7806a6', firstName: 'Emma May', lastName: 'Osei-Lah',
  instrument: 'Lead Female Vocal/Rapper', email: 'emma_osei_lah@hotmail.com', phoneNumber: '+447000000002', fee: 400 };
// Band-member order differs from the stable vocal-role order, as in the live seven-piece.
const lineup = { bandMembers: [emma, { instrument: 'Bass' }, { instrument: 'Guitar' },
  { instrument: 'Drums' }, { instrument: 'Saxophone' }, kedesha] };
const offer = (member = kedesha, total = 823) => ({ musicianId: member.musicianId,
  phone: member.phoneNumber, total, includesTravel: true });
const request = () => ({ source: 'encore_enquiry_board', targetMember: kedesha, slotIndex: 0,
  approvedOffer: offer(), inheritedDuties: 'Lead vocals, 5pm–midnight; 2x60 with breaks' });
const dateISO = '2027-09-04';

test('Kedesha-only selection in the seven-piece cannot fan out to Emma', () => {
  const result = plan({ body: request(), lineup, dateISO });
  assert.equal(result.single.member.musicianId, kedesha.musicianId);
  assert.equal(result.single.slotIndex, 0);
  assert.equal(result.primary.length, 1);
  assert.equal(approvedAvailabilityFee(result.single.offer, 355), 823);
  assert.equal(approvedAvailabilityFee(result.single.offer, 823 + 368), 823);
  assert.match(availabilityEnquiryDuties(request(), result.single.member), /not a confirmed booking/);
});

test('the exact incident payload with band-array slot 5 stops before sending', () => {
  assert.throws(() => plan({ body: { ...request(), slotIndex: 5 }, lineup, dateISO }),
    { code: 'AVAILABILITY_SLOT_MISMATCH' });
});

test('managed requests cannot silently fall back to old roster fees', () => {
  const body = request(); delete body.approvedOffer;
  assert.throws(() => plan({ body, lineup, dateISO }), { code: 'AVAILABILITY_OFFER_REQUIRED' });
  for (const patch of [{ total: '823' }, { total: NaN }, { total: -1 }, { total: 0 },
    { total: 823.001 }, { includesTravel: false }, { phone: '' }]) {
    assert.throws(() => plan({ body: { ...request(), approvedOffer: { ...offer(), ...patch } }, lineup, dateISO }));
  }
});

test('unknown target, contradictory identity and recipient/offer mismatch stop', () => {
  for (const patch of [{ phoneNumber: '+447000000099' }, { email: 'other@example.test' },
    { musicianId: 'other-musician' }]) {
    assert.throws(() => plan({ body: { ...request(), targetMember: { ...kedesha, ...patch } }, lineup, dateISO }),
      { code: 'AVAILABILITY_TARGET_INVALID' });
  }
  assert.throws(() => assertApprovedAvailabilityRecipient(offer(), emma.musicianId, kedesha.phoneNumber),
    { code: 'AVAILABILITY_RECIPIENT_MISMATCH' });
  assert.throws(() => assertApprovedAvailabilityRecipient(offer(), kedesha.musicianId, emma.phoneNumber),
    { code: 'AVAILABILITY_RECIPIENT_MISMATCH' });
});

test('a bulk send containing restricted Emma is rejected as a whole', async () => {
  let sends = 0;
  const sendBatch = () => {
    const result = plan({ body: { source: 'encore_enquiry_board', approvedOffers: [offer(), offer(emma, 723)] }, lineup, dateISO });
    sends += result.primary.length;
  };
  assert.throws(sendBatch, { code: 'AVAILABILITY_CONTACT_RESTRICTED' });
  assert.equal(sends, 0);
});

test('Emma restriction also applies to deputies and needs a date-specific authorized exception', () => {
  assert.throws(() => plan({ body: { isDeputy: true, deputy: emma, slotIndex: 0 }, lineup, dateISO }),
    { code: 'AVAILABILITY_CONTACT_RESTRICTED' });
  // Do not invent a last-minute threshold or treat a Monday check as availability YES.
  assert.doesNotThrow(() => assertAvailabilityContactAllowed(emma, '2027-09-06'));
  assert.throws(() => assertAvailabilityContactAllowed(emma, dateISO, { approved: true }));
  const approval = { musicianId: emma.musicianId, dateISO, approvedBy: 'Rhona', reason: 'Exact date contact authorized' };
  assert.doesNotThrow(() => assertAvailabilityContactAllowed(emma, dateISO, approval));
  assert.throws(() => assertAvailabilityContactAllowed(emma, '2027-09-05', approval));
});

test('all canonical recipients are checked before any caller can send a batch', async () => {
  const other = { ...emma, musicianId: 'other', email: 'other@example.test' };
  const selected = plan({ body: { source: 'encore_enquiry_board', approvedOffers: [offer(), offer(other, 723)] },
    lineup: { bandMembers: [kedesha, other] }, dateISO });
  let sends = 0;
  await assert.rejects(async () => {
    await validateAvailabilityDispatchRecipients(selected, { dateISO,
      resolveCanonical: async member => ({ _id: member === kedesha ? kedesha.musicianId : 'wrong-person' }) });
    sends += selected.primary.length;
  }, { code: 'AVAILABILITY_RECIPIENT_MISMATCH' });
  assert.equal(sends, 0);
});

test('a previous decline on another enquiry blocks before sends; different-date and NOLOC evidence do not transfer', async () => {
  const selected = plan({ body: request(), lineup, dateISO });
  const old = { _id: 'different-enquiry', reply: 'unavailable', messageSidOut: 'old-delivered' };
  let sends = 0;
  await assert.rejects(async () => {
    await validateAvailabilityDispatchRecipients(selected, { dateISO,
      resolveCanonical: async () => ({ _id: kedesha.musicianId }), loadPriorReplies: async () => [old] });
    sends++;
  }, { code: 'AVAILABILITY_PRIOR_DECLINE' });
  assert.equal(sends, 0);
  assert.equal(priorAvailabilityDeclines([{ ...old, messageSidOut: undefined }], 'Hearn Field, TQ12 4RR').length, 0);
  assert.equal(priorAvailabilityDeclines([{ ...old, reply: 'no', formattedAddress: 'London E5 0LY' }], 'Hearn Field, TQ12 4RR').length, 0);
  assert.equal(priorAvailabilityDeclines([{ ...old, reply: 'no', formattedAddress: 'Hearn Field, TQ12 4RR' }], 'Hearn Field, TQ12 4RR').length, 1);
});

test('explicit named primary selection also stays single on legacy routes', () => {
  const result = plan({ body: { selectedVocalistName: 'Kedesha Charles' }, lineup, dateISO });
  assert.equal(result.primary.length, 1);
  assert.equal(result.single.slotIndex, 0);
});
