import test from 'node:test';
import assert from 'node:assert/strict';
import { signVoiceBridge, verifyVoiceBridge, voiceConnectionConfig, buildEnquiryVoiceSession, VOICE_MAX_SECONDS } from '../services/voiceEnquiryConnection.js';
const secret = 'test-only-bridge-secret-at-least-32-characters';
const now = Date.now();
const payload = { sid: `CA${'a'.repeat(32)}`, to: '+447594223200', exp: now + 90000 };

test('voice bridge requires signed, short-lived binding to the selected incoming number', () => {
  const token = signVoiceBridge(payload, secret);
  assert.deepEqual(verifyVoiceBridge(token, secret, now), payload);
  assert.equal(verifyVoiceBridge(`${token}x`, secret, now), null);
  assert.equal(verifyVoiceBridge(token, secret, now + 120000), null);
  assert.equal(verifyVoiceBridge(signVoiceBridge({ ...payload, to: '+447700900123' }, secret), secret, now), null);
  assert.equal(verifyVoiceBridge(signVoiceBridge({ ...payload, exp: now + 600000 }, secret), secret, now), null);
});

test('feature defaults off and cannot be ready without test caller allowlist and credentials', () => {
  assert.equal(voiceConnectionConfig({}).enabled, false);
  assert.equal(voiceConnectionConfig({ VOICE_ENQUIRY_ENABLED: 'true' }).ready, false);
  const env = { VOICE_ENQUIRY_ENABLED: 'true', VOICE_ENQUIRY_PUBLIC_BASE_URL: 'https://example.com', VOICE_ENQUIRY_TWILIO_NUMBER: '+442079460123', OPENAI_VOICE_API_KEY: 'voice-test', OPENAI_API_KEY: 'unrelated-website-key', OPENAI_VOICE_WEBHOOK_SECRET: 'test', TWILIO_AUTH_TOKEN: 'test', VOICE_ENQUIRY_BRIDGE_SECRET: secret, VOICE_ENQUIRY_PROJECT_ID: 'proj_test', VOICE_ENQUIRY_TEST_CALLERS: '07700 900123', VOICE_ENQUIRY_HUMAN_NUMBER: '07594 223200' };
  const config = voiceConnectionConfig(env);
  assert.equal(config.ready, false); // No expiry means no paid test calls.
  env.VOICE_ENQUIRY_TEST_END_AT = new Date(Date.now() + 3600000).toISOString();
  assert.equal(voiceConnectionConfig(env).ready, true);
  assert.equal(voiceConnectionConfig({ ...env, VOICE_ENQUIRY_TEST_END_AT: '2000-01-01' }).ready, false);
  assert.equal(config.apiKey, 'voice-test');
  assert.equal(voiceConnectionConfig({ ...env, OPENAI_VOICE_API_KEY: '' }).ready, false);
  assert.deepEqual(config.testCallers, ['+447700900123']);
  assert.equal(config.humanNumber, ''); // Do not create a loop back to the AI number.
  assert.equal(VOICE_MAX_SECONDS, 360);
});

test('voice session has only public lookup/enquiry capture tools and tracing disabled', () => {
  const config = buildEnquiryVoiceSession({ model: 'test-model' });
  assert.deepEqual(config.tools.map(tool => tool.name), ['save_enquiry_draft', 'lookup_lineup_price', 'lookup_venue_history', 'lookup_venue', 'lookup_call_slots', 'prepare_call_appointment', 'lookup_bands', 'lookup_musician_jobs', 'get_technical_guidance', 'lookup_booking_equipment', 'request_band_availability', 'save_enquiry', 'request_callback']);
  assert.equal(config.tracing, null);
  assert.equal(config.max_output_tokens, 500);
});
