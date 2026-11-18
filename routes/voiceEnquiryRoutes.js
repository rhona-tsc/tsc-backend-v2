import {guidedQuestionXml} from '../services/voiceGuidedFlow.js';
import {initializeGuidedIntake,readGuidedIntake,acceptGuidedAnswer,acceptGuidedConsent,queueGuidedRecording,closeGuidedIntake} from '../services/voiceGuidedIntake.js';
import { startVoiceCallReview, createStoredCallTranscript, finishVoiceCallReview,readVoiceIntake } from '../services/voiceCallReview.js';
import express from 'express';
import twilio from 'twilio';
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { normalizeCallbackPhone } from '../services/incomingEnquiryAssistant.js';
import { createVoiceConversationTurns } from '../services/voiceConversationTurns.js';
import { createVoiceEnquiryTools,saveVoiceSectionProgress } from '../services/voiceEnquiryStore.js';
import { createVoiceSectionConversation } from '../services/voiceSectionConversation.js';
import { VOICE_SECTION_SESSION_INSTRUCTIONS } from '../services/voiceSectionFlow.js';
import { voiceConnectionConfig, signVoiceBridge, verifyVoiceBridge, buildEnquiryVoiceSession, voiceOpeningEventFor, VOICE_ENQUIRY_NUMBER, VOICE_MAX_SECONDS,VOICE_WEBHOOK_OVERRIDES } from '../services/voiceEnquiryConnection.js';
import { reserveVoicePilotCall } from '../services/voiceEnquiryPilotLimit.js';
import {VOICEMAIL_GREETING,VOICEMAIL_THANKS,queueVoiceRecording} from '../services/voiceVoicemail.js';

export function createVoiceEnquiryRouter({ reservePilotCall = reserveVoicePilotCall, startReview = startVoiceCallReview, createTranscript = createStoredCallTranscript, finishReview = finishVoiceCallReview,queueRecording=queueVoiceRecording,readIntake=readVoiceIntake,guided={initialize:initializeGuidedIntake,read:readGuidedIntake,answer:acceptGuidedAnswer,consent:acceptGuidedConsent,recording:queueGuidedRecording,close:closeGuidedIntake} } = {}) {
const router = express.Router();
const post=(...args)=>{const handler=args.pop();router.post(...args,(req,res,next)=>Promise.resolve().then(()=>handler(req,res,next)).catch(next));};
const sessions = new Map();
let reserving = false;
const path = '/api/voice-enquiries';
router.get('/health',(_req,res)=>{const config=voiceConnectionConfig();res.set('Cache-Control','no-store').json({enabled:config.enabled&&config.ready,mode:config.mode,testMode:true,recordsNewMessages:['voicemail','guided'].includes(config.mode),questionByQuestion:config.mode==='guided',guidedFlowVersion:2});});
const failureXml=()=>{const xml=new twilio.twiml.VoiceResponse();xml.say({voice:'Polly.Amy',language:'en-GB'},"Sorry, The Supreme Collective's message service is temporarily unavailable. We can't confirm that your message was received. Please try calling again shortly.");xml.hangup();return xml.toString();};
router.use('/twilio',(req,res,next)=>{
  res.set('Cache-Control','no-store');const send=res.send.bind(res);
  res.send=body=>{if(typeof body==='string'&&Buffer.byteLength(body)>48*1024){res.status(503).type('text/xml');return send(failureXml());}return send(body);};
  next();
});
function messageXml(config){const xml=new twilio.twiml.VoiceResponse();
  xml.say({voice:'Polly.Amy',language:'en-GB'},VOICEMAIL_GREETING);
  xml.record({maxLength:VOICE_MAX_SECONDS,timeout:10,finishOnKey:'#',playBeep:true,trim:'do-not-trim',transcribe:false,method:'POST',action:`${config.base}${path}/twilio/message-finished${VOICE_WEBHOOK_OVERRIDES}`,recordingStatusCallback:`${config.base}${path}/twilio/recording${VOICE_WEBHOOK_OVERRIDES}`,recordingStatusCallbackMethod:'POST',recordingStatusCallbackEvent:'completed absent'});
  xml.hangup();return xml.toString();
}

function sayContact(res) {
  const xml = new twilio.twiml.VoiceResponse();
  xml.say({ voice: 'Polly.Amy', language: 'en-GB' }, 'Thanks for calling The Supreme Collective. Please send your enquiry through the contact page at the supreme collective dot co dot uk, and someone from the team will get back to you.');
  xml.hangup();
  return res.type('text/xml').send(xml.toString());
}

// Twilio supplies form bodies; OpenAI needs its exact raw body for verification.
// Mount this router BEFORE the application's general JSON body parser.
post('/twilio/incoming', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const config = voiceConnectionConfig();
  if (!config.enabled || !config.ready) return res.sendStatus(503);
  const valid = twilio.validateRequest(config.twilioToken, req.get('X-Twilio-Signature') || '', `${config.base}${path}/twilio/incoming`, req.body);
  if (!valid) return res.sendStatus(403);
  const from = normalizeCallbackPhone(req.body.From);
  if (normalizeCallbackPhone(req.body.To) !== config.twilioNumber || !config.testCallers.includes(from) || !/^CA[0-9a-f]{32}$/i.test(req.body.CallSid || '')) return sayContact(res);
  const xml = new twilio.twiml.VoiceResponse();
  if(config.mode==='guided'){
    const now=Date.now(),sid=req.body.CallSid;
    for(const [key,value] of sessions)if(value.expiresAt<now)sessions.delete(key);
    let row=await readIntake(sid,from);
    if(row&&row.intent!=='guided_enquiry'){xml.say({voice:'Polly.Amy',language:'en-GB'},VOICEMAIL_THANKS);xml.hangup();return res.type('text/xml').send(xml.toString());}
    if(!row){
      if(reserving||sessions.size)return sayContact(res);
      reserving=true;
      try{
        if(!await reservePilotCall({projectId:config.projectId,callSid:sid,endsAt:config.testEndsAt,now}))return sayContact(res);
        await startReview({callSid:sid,caller:from,intent:'guided_enquiry'});
        row=await guided.initialize(sid);
      }finally{reserving=false;}
    }
    if(!row?.guided)return res.status(503).type('text/xml').send(failureXml());
    sessions.set(sid,{intent:'guided_enquiry',expiresAt:+new Date(row.startedAt)+(VOICE_MAX_SECONDS+60)*1000});
    return res.type('text/xml').send(guidedQuestionXml(row,config,{opening:row.guided.step===0}));
  }
  if(config.mode==='voicemail'){
    const now=Date.now(),sid=req.body.CallSid;
    for(const [key,value] of sessions)if(value.expiresAt<now)sessions.delete(key);
    let existing;
    try{existing=sessions.get(sid)?.intent==='voicemail'?{}:await readIntake(sid,from);}catch{return res.status(503).type('text/xml').send(failureXml());}
    if(existing){
      if(existing.recording?.sid||existing.recording?.status==='absent'){xml.say({voice:'Polly.Amy',language:'en-GB'},VOICEMAIL_THANKS);xml.hangup();return res.type('text/xml').send(xml.toString());}
      sessions.set(sid,{intent:'voicemail',expiresAt:now+(VOICE_MAX_SECONDS+60)*1000});
      return res.type('text/xml').send(messageXml(config));
    }
    if(reserving||sessions.size)return sayContact(res);
    reserving=true;let reserved=false;
    try{reserved=await reservePilotCall({projectId:config.projectId,callSid:sid,endsAt:config.testEndsAt,now});}catch{}finally{reserving=false;}
    if(!reserved)return sayContact(res);
    try{await startReview({callSid:sid,caller:from,intent:'voicemail'});}catch{return sayContact(res);}
    sessions.set(sid,{intent:'voicemail',expiresAt:now+(VOICE_MAX_SECONDS+60)*1000});
    return res.type('text/xml').send(messageXml(config));
  }
  if (!['1', '2'].includes(req.body.Digits)) {
    const gather = xml.gather({ input: 'dtmf', numDigits: 1, timeout: 8, method: 'POST', action: `${path}/twilio/incoming` });
    gather.say({ voice: 'Polly.Amy', language: 'en-GB' }, 'Welcome to The Supreme Collective. Press one for our AI assistant to help with band bookings or musician enquiries, or two for help arranging a call with someone from the team.');
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
  try { await startReview({ callSid: sid, caller: from, intent: req.body.Digits === '2' ? 'human_callback' : 'enquiry' }); } catch { return sayContact(res); }
  sessions.set(sid, { intent: req.body.Digits === '2' ? 'human_callback' : 'enquiry', expiresAt: now + (VOICE_MAX_SECONDS + 30) * 1000, connecting: false, testCaller: from });
  const token = signVoiceBridge({ sid, to: VOICE_ENQUIRY_NUMBER, exp: now + 90000 }, config.bridgeSecret);
  const sip = `sip:${config.projectId}@sip.api.openai.com;transport=tls?X-TSC-Bridge=${encodeURIComponent(token)}`;
  xml.dial({ timeLimit: VOICE_MAX_SECONDS, timeout: 20, method: 'POST', action: `${path}/twilio/finished` }).sip(sip);
  return res.type('text/xml').send(xml.toString());
});

function validGuidedCallback(req,config){
  return !!config.base&&!!config.twilioToken&&twilio.validateRequest(config.twilioToken,req.get('X-Twilio-Signature')||'',`${config.base}${path}${req.path}`,req.body)&&req.body.AccountSid===process.env.TWILIO_ACCOUNT_SID;
}
post('/twilio/guided/answer/:step',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const config=voiceConnectionConfig();if(!validGuidedCallback(req,config))return res.sendStatus(403);
  if(!/^[0-6]$/.test(req.params.step))return res.sendStatus(400);
  const row=await guided.answer(req.body.CallSid,Number(req.params.step),req.body);if(!row)return res.sendStatus(404);
  if(row.guided.status!=='collecting')sessions.delete(req.body.CallSid);
  return res.type('text/xml').send(guidedQuestionXml(row,config,{notice:req.body.Digits&&req.body.Digits!=='hangup'?'Thank you.':''}));
});
post('/twilio/guided/recording/:step',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const config=voiceConnectionConfig();if(!validGuidedCallback(req,config))return res.sendStatus(403);
  if(!/^[0-6]$/.test(req.params.step))return res.sendStatus(400);
  return res.sendStatus(await guided.recording(req.body.CallSid,Number(req.params.step),req.body)?200:404);
});
post('/twilio/guided/consent',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const config=voiceConnectionConfig();if(!validGuidedCallback(req,config))return res.sendStatus(403);
  const row=await guided.consent(req.body.CallSid,req.body.Digits);if(!row)return res.sendStatus(404);
  if(row.guided.status!=='collecting')sessions.delete(req.body.CallSid);
  return res.type('text/xml').send(guidedQuestionXml(row,config));
});

post('/twilio/message-finished',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const config=voiceConnectionConfig();
  if(!config.base||!config.twilioToken||!twilio.validateRequest(config.twilioToken,req.get('X-Twilio-Signature')||'',`${config.base}${path}/twilio/message-finished`,req.body))return res.sendStatus(403);
  sessions.delete(req.body.CallSid);
  const xml=new twilio.twiml.VoiceResponse();
  xml.say({voice:'Polly.Amy',language:'en-GB'},/^RE[a-f\d]{32}$/i.test(req.body.RecordingSid||'')?VOICEMAIL_THANKS:'We did not receive a recorded message. Please leave a message next time you call.');xml.hangup();
  return res.type('text/xml').send(xml.toString());
});
post('/twilio/recording',express.urlencoded({extended:false,limit:'16kb'}),async(req,res)=>{
  const config=voiceConnectionConfig();
  if(!config.base||!config.twilioToken||!twilio.validateRequest(config.twilioToken,req.get('X-Twilio-Signature')||'',`${config.base}${path}/twilio/recording`,req.body)||req.body.AccountSid!==process.env.TWILIO_ACCOUNT_SID)return res.sendStatus(403);
  try{const queued=await queueRecording(req.body);if(!queued)return res.sendStatus(404);sessions.delete(req.body.CallSid);return res.sendStatus(200);}catch{return res.sendStatus(503);}
});

post('/twilio/finished', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const config = voiceConnectionConfig();
  if (!config.ready || !twilio.validateRequest(config.twilioToken, req.get('X-Twilio-Signature') || '', `${config.base}${path}/twilio/finished`, req.body)) return res.sendStatus(403);
  const session = sessions.get(req.body.CallSid);
  if(session?.intent==='guided_enquiry'||(!session&&(await guided.read(req.body.CallSid))?.intent==='guided_enquiry')){await guided.close(req.body.CallSid);sessions.delete(req.body.CallSid);const xml=new twilio.twiml.VoiceResponse();xml.hangup();return res.type('text/xml').send(xml.toString());}
  if (session?.end) await session.end();
  else if (/^CA[0-9a-f]{32}$/i.test(req.body.CallSid || '')) { await finishReview(req.body.CallSid).catch(() => {}); sessions.delete(req.body.CallSid); }
  const xml = new twilio.twiml.VoiceResponse(); xml.hangup(); return res.type('text/xml').send(xml.toString());
});

post('/openai/webhook', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
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
    const handleTool = createVoiceEnquiryTools({ trustedTestCaller: config.testCallers.includes(binding.testCaller) });
    const sessionConfig = buildEnquiryVoiceSession(config);
    await client.realtime.calls.accept(callId, binding.intent==='enquiry'?{...sessionConfig,instructions:VOICE_SECTION_SESSION_INSTRUCTIONS}:sessionConfig);
    binding.callId = callId;
    const connection = await OpenAIRealtimeWS.create(client, { callID: callId, options: { handshakeTimeout: 10000, maxPayload: 1024 * 1024 } });
    const transcript = createTranscript(payload.sid);
    let turns;
    let ending = false;
    const end = async () => {
      if (ending) return;
      ending = true;
      clearTimeout(timer); clearTimeout(warningTimer);
      try { await client.realtime.calls.hangup(callId); } catch {}
      connection.close();
      await turns?.close().catch(() => {});
      await transcript.flush().catch(() => {});
      await finishReview(payload.sid).catch(() => {});
      sessions.delete(payload.sid);
    };
    binding.end = end;
    const warningTimer = setTimeout(() => { try { if (!ending) connection.send({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'The test call has 45 seconds left. Keep this brief: checkpoint any partial details with save_enquiry_draft unless already confirmed. Ask for the one most important missing contact detail, or explain that the team will review the draft. Do not repeat the full enquiry or claim it is confirmed.'}]}}); } catch {} }, (VOICE_MAX_SECONDS-45)*1000);
    warningTimer.unref?.();
    const timer = setTimeout(end, VOICE_MAX_SECONDS * 1000);
    timer.unref?.();
    const createConversation=binding.intent==='enquiry'?createVoiceSectionConversation:createVoiceConversationTurns;
    turns = createConversation({send:event=>connection.send(event),handleTool,callId:payload.sid,callerNumber:binding.testCaller,saveProgress:saveVoiceSectionProgress,
      openingEvent:voiceOpeningEventFor(binding.intent),instructions:sessionConfig.instructions,onError:()=>{void end();}});
    connection.socket.on('open', () => turns.start());
    connection.on('event', event => turns.accept(event));
    for (const event of ['conversation.item.added', 'conversation.item.created', 'response.output_item.added', 'input_audio_buffer.committed', 'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed', 'response.output_audio_transcript.done', 'conversation.item.truncated']) connection.on(event, data => transcript.accept(data));
    connection.socket.on('close', end);
    connection.on('error', end); // Transcript text goes only to the protected review store; never application logs.
    return res.sendStatus(200);
  } catch {
    try { await client.realtime.calls.hangup(callId); } catch {}
    await finishReview(payload.sid, { status: 'connection_failed' }).catch(() => {});
    sessions.delete(payload.sid);
    return res.sendStatus(502);
  }
});

router.use((error,req,res,next)=>{if(!req.path.startsWith('/twilio/'))return next(error);if(res.headersSent)return res.end();return res.status(503).type('text/xml').send(failureXml());});
return router;
}

export default createVoiceEnquiryRouter();
