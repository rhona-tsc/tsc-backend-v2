import test from 'node:test';
import assert from 'node:assert/strict';
import { holdExpiresAt, memberIsConfirmed } from '../services/enquiryHoldExpiryService.js';
test('holds expire seven days after issue, including across month boundaries', () => {
  assert.equal(holdExpiresAt('2026-10-26T19:00:00Z').toISOString(), '2026-11-02T19:00:00.000Z');
});
test('accepted and confirmed musicians protect their hold; offers and other musicians do not', () => {
  const emails = ['singer@example.com'];
  for (const status of ['accepted', 'confirmed']) assert.equal(memberIsConfirmed({ email: 'Singer@Example.com', status }, emails), true);
  assert.equal(memberIsConfirmed({ email: 'singer@example.com', status: 'offered' }, emails), false);
  assert.equal(memberIsConfirmed({ email: 'other@example.com', status: 'confirmed' }, emails), false);
});
