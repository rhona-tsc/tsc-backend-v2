import crypto from 'node:crypto';
import { normalizeCallbackPhone, ENQUIRY_ASSISTANT_GREETING, ENQUIRY_ASSISTANT_INSTRUCTIONS, ENQUIRY_ASSISTANT_TOOLS } from './incomingEnquiryAssistant.js';

export const VOICE_ENQUIRY_NUMBER = '+447594223200';
export const VOICE_MAX_SECONDS = 360;

export function voiceConnectionConfig(env = process.env) {
  const split = value => String(value || '').split(',').map(normalizeCallbackPhone).filter(Boolean);
  let base = '';
  try { const u = new URL(env.VOICE_ENQUIRY_PUBLIC_BASE_URL); if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash) base = u.origin; } catch {}
  const config = {
    enabled: env.VOICE_ENQUIRY_ENABLED === 'true', base,
    twilioNumber: normalizeCallbackPhone(env.VOICE_ENQUIRY_TWILIO_NUMBER),
    apiKey: env.OPENAI_VOICE_API_KEY || '', webhookSecret: env.OPENAI_VOICE_WEBHOOK_SECRET || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '', bridgeSecret: env.VOICE_ENQUIRY_BRIDGE_SECRET || '',
    projectId: /^proj_[A-Za-z0-9_-]+$/.test(env.VOICE_ENQUIRY_PROJECT_ID || '') ? env.VOICE_ENQUIRY_PROJECT_ID : '',
    testCallers: split(env.VOICE_ENQUIRY_TEST_CALLERS),
    humanNumber: normalizeCallbackPhone(env.VOICE_ENQUIRY_HUMAN_NUMBER),
    model: env.OPENAI_VOICE_MODEL || 'gpt-realtime-2.1-mini',
  };
  config.ready = !!(config.base && config.twilioNumber && config.apiKey && config.webhookSecret && config.twilioToken && config.projectId && config.bridgeSecret.length >= 32 && config.testCallers.length);
  // This first implementation is deliberately test-caller-only, even if enabled.
  if (config.humanNumber === VOICE_ENQUIRY_NUMBER) config.humanNumber = '';
  return config;
}

export function signVoiceBridge(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyVoiceBridge(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1500 || secret.length < 32) return null;
  const [body, supplied, extra] = token.split('.');
  if (!body || !supplied || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(supplied, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!/^CA[0-9a-f]{32}$/i.test(payload.sid || '') || payload.to !== VOICE_ENQUIRY_NUMBER || !Number.isFinite(payload.exp) || payload.exp < now || payload.exp > now + 120000) return null;
    return payload;
  } catch { return null; }
}

export function buildEnquiryVoiceSession(config) {
  return { type: 'realtime', model: config.model,
    instructions: ENQUIRY_ASSISTANT_INSTRUCTIONS,
    audio: { output: { voice: 'marin' } },
    output_modalities: ['audio'], max_output_tokens: 500,
    tools: ENQUIRY_ASSISTANT_TOOLS, tool_choice: 'auto', tracing: null };
}

export const voiceOpeningEvent = { type: 'response.create', response: { instructions: `Start this incoming call by saying exactly: ${ENQUIRY_ASSISTANT_GREETING}` } };
