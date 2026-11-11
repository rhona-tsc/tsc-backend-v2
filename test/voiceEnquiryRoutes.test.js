import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import twilio from 'twilio';
import { createVoiceEnquiryRouter } from '../routes/voiceEnquiryRoutes.js';

test('test-only voice ingress enforces feature flag, signatures, number and caller allowlist', async () => {
  const settings = {
    VOICE_ENQUIRY_ENABLED: 'true', VOICE_ENQUIRY_PUBLIC_BASE_URL: 'https://example.com',
    VOICE_ENQUIRY_TWILIO_NUMBER: '+442079460123',
    OPENAI_VOICE_API_KEY: 'test-key-never-used', OPENAI_VOICE_WEBHOOK_SECRET: 'test-secret-never-used',
    TWILIO_AUTH_TOKEN: 'test-token', VOICE_ENQUIRY_BRIDGE_SECRET: 'test-only-secret-at-least-32-characters',
    VOICE_ENQUIRY_PROJECT_ID: 'proj_example', VOICE_ENQUIRY_TEST_CALLERS: '+447700900123',
    VOICE_ENQUIRY_TEST_END_AT: new Date(Date.now() + 3600000).toISOString(),
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const app = express();
  let reservations = 0;
  app.use('/api/voice-enquiries', createVoiceEnquiryRouter({ reservePilotCall: async () => { reservations++; return true; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const endpoint = '/api/voice-enquiries/twilio/incoming';
  const url = `http://127.0.0.1:${server.address().port}${endpoint}`;
  const body = { From: '+447700900123', To: '+442079460123', CallSid: `CA${'b'.repeat(32)}` };
  const post = (params, signed = true) => fetch(url, { method: 'POST', body: new URLSearchParams(params), headers: signed ? {
    'X-Twilio-Signature': twilio.getExpectedTwilioSignature(settings.TWILIO_AUTH_TOKEN, `${settings.VOICE_ENQUIRY_PUBLIC_BASE_URL}${endpoint}`, params),
  } : {} });
  try {
    process.env.VOICE_ENQUIRY_ENABLED = 'false';
    assert.equal((await post(body)).status, 503);
    process.env.VOICE_ENQUIRY_ENABLED = 'true';
    assert.equal((await post(body, false)).status, 403);
    const welcome = await (await post(body)).text();
    assert.match(welcome, /AI assistant/);
    assert.match(welcome, /<Gather/);
    assert.doesNotMatch(welcome, /<Sip/);
    const rejected = await (await post({ ...body, From: '+447700900999', Digits: '1' })).text();
    assert.doesNotMatch(rejected, /<Sip/);
    const wrongNumber = await (await post({ ...body, To: '+442079460999', Digits: '1' })).text();
    assert.doesNotMatch(wrongNumber, /<Sip/);
    const bridge = await (await post({ ...body, Digits: '1' })).text();
    assert.match(bridge, /timeLimit="360"/);
    assert.match(bridge, /transport=tls/);
    assert.match(bridge, /X-TSC-Bridge=/);
    assert.equal((await post({ ...body, Digits: '1' })).status, 409);
    assert.equal(reservations, 1);
    // Producing TwiML locally does not place a call. No OpenAI API calls or DB writes occur.
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
