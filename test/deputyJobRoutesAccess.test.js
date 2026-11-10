import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

// The controller has legacy import-time integrations. Disable these for local tests.
process.env.GOOGLE_REFRESH_TOKEN = '';
process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET = 'local-deputy-route-test-secret';
const { default: router } = await import('../routes/deputyJobRoute.js');
const { default: model } = await import('../models/deputyJobModel.js');
const id = '507f1f77bcf86cd799439011';

test('actual job routes keep adverts public and deny every management action to unrelated users', async t => {
  const originalFind = model.findById;
  const originalAggregate = model.aggregate;
  const originalPopulate = model.populate;
  const record = {
    _id: id, title: 'Synthetic public job', createdBy: 'owner',
    createdByEmail: 'owner@example.test', eventDate: '2099-01-01',
    clientEmail: 'private@example.test', stripeCustomerId: 'private-payment',
    applications: [{ musicianId: 'other', email: 'private-applicant@example.test' }],
    matchedMusicians: [{ email: 'private-match@example.test' }],
  };
  model.findById = () => {
    const query = { select() { return this; }, populate() { return this; }, lean: async () => ({ ...record }) };
    return query;
  };
  model.aggregate = async () => [{ ...record }];
  model.populate = async jobs => jobs;
  const app = express();
  app.use('/api/deputy-jobs', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    model.findById = originalFind;
    model.aggregate = originalAggregate;
    model.populate = originalPopulate;
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}/api/deputy-jobs`;
  for (const path of ['', `/${id}`]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    const body = JSON.stringify(await response.json());
    assert.match(body, /Synthetic public job/);
    assert.doesNotMatch(body, /private@example|private-payment|private-applicant|private-match/);
  }
  const token = jwt.sign({ id: 'unrelated', role: 'musician' }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}` };
  for (const action of [
    'preview-notification', 'send-test-notification', 'resend-notifications',
    'send-unnotified-notifications', 'send-remaining-notifications', 'send-notifications',
    'rematch-and-send-notifications', 'retry-failed-notifications', 'close', 'present-applicant',
    'manual-allocate', 'manual-apply', 'manual-apply-and-present', 'create-setup-intent',
    'save-payment-method', 'charge', 'preview-allocation', 'confirm-allocation',
    'preview-booking-email', 'send-booking-email',
  ]) {
    const response = await fetch(`${origin}/${id}/${action}`, { method: 'POST', headers });
    assert.equal(response.status, 403, action);
  }
  for (const action of ['matches', 'applications']) {
    assert.equal((await fetch(`${origin}/${id}/${action}`, { headers })).status, 403);
    assert.equal((await fetch(`${origin}/${id}/${action}`)).status, 401);
  }
  assert.equal((await fetch(`${origin}/${id}/applications/someone/status`, { method: 'PATCH', headers })).status, 403);
  assert.equal((await fetch(`${origin}/${id}/apply`, { method: 'POST' })).status, 401);
});
