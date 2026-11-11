import express from 'express';
import twilio from 'twilio';
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { normalizeCallbackPhone, VoiceEnquiryValidationError } from '../services/incomingEnquiryAssistant.js';
import { createVoiceEnquiryTools } from '../services/voiceEnquiryStore.js';
import { voiceConnectionConfig, signVoiceBridge, verifyVoiceBridge, buildEnquiryVoiceSession, voiceOpeningEvent, VOICE_ENQUIRY_NUMBER, VOICE_MAX_SECONDS } from '../services/voiceEnquiryConnection.js';
import { reserveVoicePilotCall } from '../services/voiceEnquiryPilotLimit.js';

export function createVoiceEnquiryRouter({ reservePilotCall = reserveVoicePilotCall } = {}) {
const router = express.Router();
const sessions = new Map();
let reserving = false;
const path = '/api/voice-enquiries';

function sayContact(res) {
  const xml = new twilio.twiml.VoiceResponse();
  xml.say({ voice: 'Polly.Amy', language: 'en-GB' }, 'Thanks for calling The Supreme Collective. Please send your enquiry through the contact page at the supreme collective dot co dot uk, and Rhona’s team will get back to you.');
  xml.hangup();
  return res.type('text/xml').send(xml.toString());
}

// Twilio supplies form bodies; OpenAI needs its exact raw body for verification.
// Mount this router BEFORE the application's general JSON body parser.
router.post('/twilio/incoming', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const config = voiceConnectionConfig();
  if (!config.enabled || !config.ready) return res.sendStatus(503);
  const valid = twilio.validateRequest(config.twilioToken, req.get('X-Twilio-Signature') || '', `${config.base}${path}/twilio/incoming`, req.body);
  if (!valid) return res.sendStatus(403);
  const from = normalizeCallbackPhone(req.body.From);
  if (normalizeCallbackPhone(req.body.To) !== config.twilioNumber || !config.testCallers.includes(from) || !/^CA[0-9a-f]{32}$/i.test(req.body.CallSid || '')) return sayContact(res);
  const xml = new twilio.twiml.VoiceResponse();
  if (req.body.Digits === '2') {
    if (config.humanNumber) xml.dial({ timeout: 20, timeLimit: VOICE_MAX_SECONDS }, config.humanNumber);
    else return sayContact(res);
    return res.type('text/xml').send(xml.toString());
  }
  if (req.body.Digits !== '1') {
    const gather = xml.gather({ input: 'dtmf', numDigits: 1, timeout: 8, method: 'POST', action: `${path}/twilio/incoming` });
    gather.say({ voice: 'Polly.Amy', language: 'en-GB' }, 'Welcome to The Supreme Collective. Our AI assistant can help with band enquiries and save your details for Rhona. Press one to continue with the AI assistant, or two to request a person.');
    xml.redirect({ method: 'POST' }, `${path}/twilio/finished`);
    return res.type('text/xml').send(xml.toString());
  }
  const now = Date.now();
  for (const [sid, session] of sessions) if (session.expiresAt < now) sessions.delete(sid);
  const sid = req.body.CallSid;
  if (sessions.has(sid)) return res.sendStatus(409); // Never bridge a duplicate call request twice.
  if (sessions.size || reserving) return sayContact(res);
  reserving = true;
  let reserved = false;
  try { reserved = await reservePilotCall({ projectId: config.projectId, callSid: sid, endsAt: config.testEndsAt, now }); }
  catch {} finally { reserving = false; }
  if (!reserved) return sayContact(res);
  sessions.set(sid, { expiresAt: now + (VOICE_MAX_SECONDS + 30) * 1000, connecting: false });
  const token = signVoiceBridge({ sid, to: VOICE_ENQUIRY_NUMBER, exp: now + 90000 }, config.bridgeSecret);
  const sip = `sip:${config.projectId}@sip.api.openai.com;transport=tls?X-TSC-Bridge=${encodeURIComponent(token)}`;
  xml.dial({ timeLimit: VOICE_MAX_SECONDS, timeout: 20, method: 'POST', action: `${path}/twilio/finished` }).sip(sip);
  return res.type('text/xml').send(xml.toString());
});

router.post('/twilio/finished', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
  const config = voiceConnectionConfig();
  if (!config.ready || !twilio.validateRequest(config.twilioToken, req.get('X-Twilio-Signature') || '', `${config.base}${path}/twilio/finished`, req.body)) return res.sendStatus(403);
  sessions.delete(req.body.CallSid);
  return sayContact(res);
});

router.post('/openai/webhook', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
  const config = voiceConnectionConfig();
  if (!config.enabled || !config.ready) return res.sendStatus(503);
  const client = new OpenAI({ apiKey: config.apiKey, webhookSecret: config.webhookSecret, maxRetries: 0, timeout: 10000 });
  let event;
  try { event = await client.webhooks.unwrap(req.body.toString('utf8'), req.headers); }
  catch { return res.sendStatus(400); }
  if (event.type !== 'realtime.call.incoming') return res.sendStatus(200);
  const callId = event.data?.call_id;
  if (typeof callId !== 'string' || callId.length > 200) return res.sendStatus(400);
  const token = event.data.sip_headers?.find(header => String(header.name).toLowerCase() === 'x-tsc-bridge')?.value;
  const payload = verifyVoiceBridge(token, config.bridgeSecret);
  const binding = payload && sessions.get(payload.sid);
  if (!binding) {
    try { await client.realtime.calls.reject(callId, { status_code: 403 }); } catch {}
    return res.sendStatus(200);
  }
  if (binding.callId === callId || binding.connecting) return res.sendStatus(200);
  if (binding.callId) {
    try { await client.realtime.calls.reject(callId, { status_code: 486 }); } catch {}
    return res.sendStatus(200);
  }
  binding.connecting = true;
  try {
    const handleTool = createVoiceEnquiryTools();
    await client.realtime.calls.accept(callId, buildEnquiryVoiceSession(config));
    binding.callId = callId;
    const connection = await OpenAIRealtimeWS.create(client, { callID: callId, options: { handshakeTimeout: 10000, maxPayload: 1024 * 1024 } });
    let ending = false;
    const end = async () => {
      if (ending) return;
      ending = true;
      clearTimeout(timer);
      try { await client.realtime.calls.hangup(callId); } catch {}
      connection.close();
      sessions.delete(payload.sid);
    };
    const timer = setTimeout(end, VOICE_MAX_SECONDS * 1000);
    timer.unref?.();
    connection.socket.on('open', () => connection.send(voiceOpeningEvent));
    connection.socket.on('close', end);
    connection.on('error', end); // Never log call audio/transcripts or personal details.
    const results = new Map();
    let queue = Promise.resolve();
    connection.on('response.function_call_arguments.done', tool => {
      queue = queue.then(async () => {
        if (ending) return;
        let result = results.get(tool.call_id);
        if (!result) {
          try { result = await handleTool({ callId: payload.sid, name: tool.name, arguments: tool.arguments }); }
          catch (error) { result = { ...(tool.name === 'request_band_availability' ? { prepared: false, testMode: true, sent: 0 } : { saved: false }), error: error instanceof VoiceEnquiryValidationError ? error.message
            : 'Could not complete this request. Confirm the required details or offer the contact page. Do not claim success.' }; }
          results.set(tool.call_id, result);
        }
        connection.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: tool.call_id, output: JSON.stringify(result) } });
        connection.send({ type: 'response.create' });
      }).catch(end);
    });
    return res.sendStatus(200);
  } catch {
    try { await client.realtime.calls.hangup(callId); } catch {}
    sessions.delete(payload.sid);
    return res.sendStatus(502);
  }
});

return router;
}

export default createVoiceEnquiryRouter();
