import test from 'node:test';
import assert from 'node:assert/strict';
import { encoreRequestEnquiryScope, enquiryAvailabilityFilter, enquiryAvailabilityRequests, enquiryAvailabilitySlots } from '../services/enquiryAvailabilityTracking.js';

test('Encore requests cannot reuse another enquiry response or active request', () => {
  assert.deepEqual(encoreRequestEnquiryScope({ source: 'encore_enquiry_board', enquiryId: 'JOB-A' }), { enquiryId: 'JOB-A' });
  assert.deepEqual(encoreRequestEnquiryScope({ source: 'manual_enquiry_board', enquiryId: 'JOB-A' }), {});
  assert.notDeepEqual(encoreRequestEnquiryScope({ source: 'encore_enquiry_board', enquiryId: 'JOB-A' }), encoreRequestEnquiryScope({ source: 'encore_enquiry_board', enquiryId: 'JOB-B' }));
});

test('email-less enquiries are scoped by reference, act, date and selected lineup', () => {
  const row = { enquiryRef: 'SJxqh', actId: 'act-a', eventDateISO: '2027-04-03', lineupId: 'lineup-a' };
  assert.deepEqual(enquiryAvailabilityFilter(row), { enquiryId: 'SJxqh', actId: 'act-a', dateISO: '2027-04-03', lineupId: 'lineup-a' });
  assert.notDeepEqual(enquiryAvailabilityFilter(row), enquiryAvailabilityFilter({ ...row, enquiryRef: 'other-job' }));
  assert.equal(enquiryAvailabilityFilter({ ...row, enquiryRef: '' }), null);
});
test('delivery and calendar acceptance never masquerade as a positive reply', () => {
  const requests = enquiryAvailabilityRequests([{ _id: 'r1', actId: 'act-a', slotIndex: 0, status: 'accepted', calendarStatus: 'accepted', deliveryStatus: 'read' }]);
  assert.equal(requests[0].reply, null);
  assert.equal(enquiryAvailabilitySlots(requests)[0].status, 'pending');
});
test('latest request per slot replaces an old yes; other slots and failures remain visible', () => {
  const requests = [
    { slotIndex: 0, reply: 'yes', updatedAt: '2026-11-10' },
    { slotIndex: 0, reply: null, status: 'sent', updatedAt: '2026-11-12' },
    { slotIndex: 1, reply: 'no', status: 'declined', updatedAt: '2026-11-12' },
    { slotIndex: 2, reply: null, status: 'failed', updatedAt: '2026-11-12' },
  ];
  assert.deepEqual(enquiryAvailabilitySlots(requests).map(slot => [slot.reply, slot.status]), [[null, 'pending'], ['no', 'declined'], [null, 'failed']]);
});
test('only musician website messages are exposed for reply review', () => {
  const [request] = enquiryAvailabilityRequests([{ _id: 'r1', actId: 'a', websiteReplies: [{ senderRole: 'agent', body: 'internal' }, { senderRole: 'musician', body: 'What time is setup?' }] }]);
  assert.deepEqual(request.musicianMessages.map(message => message.body), ['What time is setup?']);
});
