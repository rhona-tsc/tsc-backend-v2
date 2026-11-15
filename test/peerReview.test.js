import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { finalRoster, validateReview, londonParts, reviewEmail } from '../services/peerReviewService.js';
import router from '../routes/peerReviewRoutes.js';
test('only final participating musicians can be reviewed; duplicate instruments do not duplicate people', () => {
  const id = '6943ffb7a034dd3ebd69fefb';
  assert.equal(finalRoster({ assignedMusicians: [{ musicianId: id, status: 'confirmed' }, { musicianId: id, status: 'confirmed' }, { musicianId: '6943ffb7a034dd3ebd69fefa', status: 'declined' }] }).length, 1);
  assert.equal(finalRoster({ assignedMusicians: [{ musicianId: id, status: 'confirmed', withdrawnAt: new Date() }] }).length, 0);
});
test('ratings validate server side and allow not observed without including it in scores', () => {
  assert.deepEqual(validateReview({ ratings: { Performance: 5, Teamwork: null }, comment: ' Good ' }), { ratings: { Performance: 5 }, comment: 'Good' });
  assert.throws(() => validateReview({ ratings: { Performance: 6 } }));
  assert.throws(() => validateReview({}));
});
test('midday scheduling uses London time in summer and winter', () => {
  assert.equal(londonParts(new Date('2027-06-01T11:00:00Z')).hour, '12');
  assert.equal(londonParts(new Date('2026-11-16T12:00:00Z')).hour, '12');
});
test('invitation explains privacy, staff identity access, and links to authenticated dashboard', () => {
  const mail = reviewEmail({ name: '<Sam>', act: 'Test act', date: '2026-11-15' });
  assert.match(mail.html, /&lt;Sam&gt;/); assert.match(mail.html, /#peer-feedback/);
  assert.match(mail.text, /TSC can identify/); assert.match(mail.text, /nothing appears on public profiles/);
});
test('public and musician callers cannot read moderation submissions or send rollout emails', async () => {
  process.env.JWT_SECRET = 'peer-review-test-secret';
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/moderation`)).status, 401);
    const token = jwt.sign({ id: '6943ffb7a034dd3ebd69fefb', role: 'musician', email: 'person@example.com' }, process.env.JWT_SECRET);
    assert.equal((await fetch(`${url}/moderation`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch(`${url}/rollout`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{"send":true}' })).status, 403);
  } finally { server.close(); }
});
