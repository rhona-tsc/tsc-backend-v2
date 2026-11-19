import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityCalendarContact as resolve } from '../services/availabilityCalendarContact.js';

const request = { phone: '+447000000001', lineupId: 'six', musicianName: 'Sophia Pozzobone' };
const correct = { firstName: 'Sophia', lastName: 'Pozzobone', phoneNumber: '+44 7000 000001', email: 'Correct@Example.test' };
const wrong = { firstName: 'Sophia', lastName: 'Romaine', phone: '+447000000002', email: 'wrong@example.test' };
const act = { lineups: [{ _id: 'six', bandMembers: [wrong, correct] }] };

test('a roster-only respondent uses her own email, never the first matching Sophia', () => {
  assert.equal(resolve({ request, act }), 'correct@example.test');
});
test('a different canonical phone fails closed even when the first name matches', () => {
  assert.throws(() => resolve({ request, musician: wrong, act }), /does not match/);
});
test('a canonical record must have the actual respondent phone', () => {
  assert.equal(resolve({ request, musician: { phoneNormalized: request.phone, email: 'canonical@example.test' }, act }), 'canonical@example.test');
  assert.throws(() => resolve({ request, musician: { email: 'wrong@example.test' }, act }), /does not match/);
});
test('an unverified request email or name alone cannot receive an invitation', () => {
  assert.equal(resolve({ request: { ...request, musicianEmail: wrong.email }, act: { lineups: [] } }), null);
  assert.equal(resolve({ request: { musicianName: wrong.firstName, lineupId: 'six' }, act }), null);
});
test('lookup stays within the exact lineup and handles verified deputy contacts', () => {
  assert.equal(resolve({ request: { ...request, lineupId: 'other' }, act }), null);
  assert.equal(resolve({ request, act: { lineups: [{ _id: 'six', bandMembers: [{ deputies: [correct] }] }] } }), 'correct@example.test');
});
test('conflicting emails for one phone are held, while identical duplicates are safe', () => {
  assert.throws(() => resolve({ request, act: { lineups: [{ _id: 'six', bandMembers: [correct, { ...correct, email: wrong.email }] }] } }), /Multiple emails/);
  assert.equal(resolve({ request, act: { lineups: [{ _id: 'six', bandMembers: [correct, { ...correct }] }] } }), 'correct@example.test');
});
