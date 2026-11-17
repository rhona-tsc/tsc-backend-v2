import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import twilio from 'twilio';
import jwt from 'jsonwebtoken';
import {Readable} from 'node:stream';
import {createVoiceEnquiryRouter} from '../routes/voiceEnquiryRoutes.js';
import musicianAuth from '../middleware/musicianAuth.js';
import {VOICEMAIL_GREETING,VOICEMAIL_THANKS,queueVoiceRecording,processVoiceMessage,downloadTwilioRecording,publicVoiceRecording,createVoiceAudioHandler,voicemailDraft} from '../services/voiceVoicemail.js';
const sid=`CA${'a'.repeat(32)}`,recordingSid=`RE${'b'.repeat(32)}`,account=`AC${'c'.repeat(32)}`;
const row=()=>({_id:'PHONE-111111111111',intent:'voicemail',callSid:sid,expiresAt:new Date(Date.now()+86400000),recording:{sid:recordingSid,attempts:1,durationSeconds:20}});
const settings={VOICE_ENQUIRY_MODE:'voicemail',VOICE_ENQUIRY_ENABLED:'true',VOICE_ENQUIRY_PUBLIC_BASE_URL:'https://example.com',VOICE_ENQUIRY_TWILIO_NUMBER:'+447700900100',OPENAI_VOICE_API_KEY:'test-unused-key',OPENAI_VOICE_WEBHOOK_SECRET:'test-unused-secret',TWILIO_AUTH_TOKEN:'test-token',TWILIO_ACCOUNT_SID:account,VOICE_ENQUIRY_BRIDGE_SECRET:'test-only-secret-at-least-32-characters',VOICE_ENQUIRY_PROJECT_ID:'proj_example',VOICE_ENQUIRY_TEST_CALLERS:'+447700900123',VOICE_ENQUIRY_TEST_END_AT:new Date(Date.now()+3600000).toISOString()};
const setEnv=values=>{const before=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);return()=>{for(const [k,v]of Object.entries(before))v===undefined?delete process.env[k]:process.env[k]=v;};};
async function listen(app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return {base:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};}

test('recording pilot gives notice before the tone, captures one uninterrupted message and never starts the chat',async()=>{
 const restore=setEnv(settings),app=express();let reserved=0,started=0,queued=0;
 app.use('/api/voice-enquiries',createVoiceEnquiryRouter({reservePilotCall:async()=>{reserved++;return true;},startReview:async data=>{assert.equal(data.intent,'voicemail');started++;},queueRecording:async()=>{queued++;return true;}}));
 const http=await listen(app);const post=async(path,body,signed=true)=>fetch(`${http.base}/api/voice-enquiries/twilio/${path}`,{method:'POST',body:new URLSearchParams(body),headers:signed?{'X-Twilio-Signature':twilio.getExpectedTwilioSignature(settings.TWILIO_AUTH_TOKEN,`https://example.com/api/voice-enquiries/twilio/${path}`,body)}:{}});
 const body={CallSid:sid,From:'+447700900123',To:'+447700900100'};
 try{
  assert.equal((await fetch(`${http.base}/api/voice-enquiries/health`)).status,200);assert.equal(reserved,0);
  assert.equal((await post('incoming',body,false)).status,403);
  assert.doesNotMatch(await(await post('incoming',{...body,From:'+447700900999'})).text(),/<Record/);assert.equal(reserved,0);
  const xml=await(await post('incoming',body)).text();assert.match(xml,/recorded and transcribed/);assert.ok(xml.indexOf('recorded and transcribed')<xml.indexOf('<Record'));
  assert.match(xml,/<Record[^>]+maxLength="360"/);assert.match(xml,/timeout="10"/);assert.match(xml,/finishOnKey="#"/);assert.match(xml,/Polly.Amy/);assert.doesNotMatch(xml,/<Sip|<Dial|<Gather/);assert.equal(reserved,1);assert.equal(started,1);
  assert.equal((await post('incoming',body)).status,409);assert.equal(reserved,1);
  const callback={CallSid:sid,AccountSid:account,RecordingSid:recordingSid,RecordingStatus:'completed',RecordingDuration:'20'};
  process.env.VOICE_ENQUIRY_TEST_END_AT=new Date(1).toISOString(); // Already-authorized messages still finish after intake closes.
  assert.equal((await post('recording',callback,false)).status,403);assert.equal(queued,0);
  assert.equal((await post('recording',{...callback,AccountSid:`AC${'d'.repeat(32)}`})).status,403);assert.equal(queued,0);
  assert.equal((await post('recording',callback)).status,200);assert.equal(queued,1);
  const ending=await(await post('message-finished',callback)).text();assert.match(ending,/no customer emails or band requests/);assert.doesNotMatch(ending,/options direct to your inbox/);
 }finally{await http.close();restore();}
});

test('recording callbacks are bounded, belong to a known voicemail and cannot reset a processed recording',async()=>{
 const current=row();delete current.recording;const updates=[];
 const calls={findOne:async()=>current,updateOne:async(filter,update)=>{updates.push(update);current.recording=update.$set.recording;}};
 const body={CallSid:sid,RecordingSid:recordingSid,RecordingStatus:'completed',RecordingDuration:'20',RecordingUrl:'https://attacker.example/secret'};
 assert.equal(await queueVoiceRecording({...body,RecordingDuration:'999'},{calls}),false);
 assert.equal(await queueVoiceRecording(body,{calls}),true);assert.equal(await queueVoiceRecording(body,{calls}),true);assert.equal(updates.length,1);
 assert.doesNotMatch(JSON.stringify(updates),/attacker|RecordingUrl/);
 assert.equal(await queueVoiceRecording({...body,RecordingSid:`RE${'e'.repeat(32)}`},{calls}),false);
});

test('provider download checks call ownership and uses only a fixed authenticated URL',async()=>{
 const restore=setEnv(settings);let requested='';const request=async(url,options)=>{requested=url;assert.match(options.headers.Authorization,/^Basic /);return new Response(Buffer.from('ID3 fixture'),{headers:{'content-type':'audio/mpeg'}});};
 try{
  await assert.rejects(downloadTwilioRecording(row(),{request,client:{recordings:()=>({fetch:async()=>({callSid:'wrong-call',status:'completed',duration:'20'})})}}),/belong/);assert.equal(requested,'');
  const audio=await downloadTwilioRecording(row(),{request,client:{recordings:()=>({fetch:async()=>({callSid:sid,status:'completed',duration:'20'})})}});assert.equal(audio.toString(),'ID3 fixture');assert.equal(requested,`https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${recordingSid}.mp3`);
 }finally{restore();}
});

const transcript='Mary Example wants a six-piece Soul wedding band with saxophone at the Ritz London on 14 December 2028. Budget 4000 pounds. Email mary@example.com and callback 07700900123. Maybe a band member DJ set.';
const extracted={clientName:'Mary Example',clientEmail:'mary@example.com',clientPhone:'07700900123',eventDateISO:'2028-12-14',eventType:'wedding',address:'Ritz London',styles:['Soul'],preferredSize:'6-piece',mustHaveInstruments:['Saxophone'],maxBudget:4000,bandNames:[],reason:'Wedding band enquiry',notes:'Band member DJ set',topic:'client_event'};
test('message processing preserves private audio before removing the provider copy, then saves an unconfirmed draft and suggestions only',async()=>{
 const events=[],updates=[];let saved;
 const result=await processVoiceMessage(row(),{calls:{updateOne:async(f,u)=>updates.push(u)},download:async()=>{events.push('download');return Buffer.from('audio');},storeAudio:async()=>{events.push('private-store');return 'file-id';},removeCopy:async()=>{events.push('remove-provider-copy');return true;},transcribe:async()=>transcript,extract:async()=>extracted,saveDraft:async(id,draft)=>{saved=draft;},lookupBands:async criteria=>{assert.deepEqual(criteria.styles,['Soul']);assert.deepEqual(criteria.mustHaveInstruments,['Saxophone']);return {bands:[{actId:'one',name:'Example Soul Band'}]};},finish:async(id,options)=>{assert.equal(options.status,'message_saved');events.push('notify-management');}});
 assert.deepEqual(events,['download','private-store','remove-provider-copy','notify-management']);assert.equal(result.messagesSent,0);
 assert.equal(saved.clientEmail,'mary@example.com');assert.equal(saved.eventDateISO,'2028-12-14');assert.equal(saved.maxBudget,4000);assert.equal(saved.selectedBands,undefined);assert.equal(saved.confirmed,undefined);
 assert.ok(updates.some(u=>u.$set?.['voicemail.reviewRequired']===true));assert.ok(updates.some(u=>u.$set?.['voicemail.messagesSent']===0));
});

test('transcription failure keeps the listenable recording and produces a management review after bounded attempts',async()=>{
 const updates=[],r=row();r.recording.attempts=3;let finished=false;
 const result=await processVoiceMessage(r,{calls:{updateOne:async(f,u)=>updates.push(u)},download:async()=>Buffer.from('audio'),storeAudio:async()=> 'file-id',removeCopy:async()=>true,transcribe:async()=>{throw Error('private API error must not reach logs');},finish:async(id,options)=>{assert.equal(options.status,'message_needs_review');finished=true;}});
 assert.equal(finished,true);assert.equal(result.saved,false);assert.equal(result.messagesSent,0);assert.ok(updates.some(u=>u.$set?.['recording.fileId']==='file-id'));assert.ok(updates.some(u=>u.$set?.['voicemail.status']==='needs_review'));
 assert.doesNotMatch(JSON.stringify(updates),/private API error/);
});

test('private playback rejects anonymous, musician and agent access and never exposes a provider link',async()=>{
 const restore=setEnv({JWT_SECRET:'synthetic-only-test-secret'}),app=express();let opens=0;
 app.get('/audio/:ref',musicianAuth,createVoiceAudioHandler({open:async()=>{opens++;return {stream:Readable.from(Buffer.from('ID3 fixture')),length:11};}}));const http=await listen(app);
 const get=role=>fetch(`${http.base}/audio/PHONE-111111111111`,{headers:role?{Authorization:`Bearer ${jwt.sign({id:'fixture',role},process.env.JWT_SECRET)}`}:{}});
 try{assert.equal((await get()).status,401);for(const role of ['musician','agent'])assert.equal((await get(role)).status,403);assert.equal(opens,0);const response=await get('admin');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.match(response.headers.get('content-type'),/audio\/mpeg/);assert.equal(await response.text(),'ID3 fixture');assert.equal(opens,1);}finally{await http.close();restore();}
});

test('recording summaries expose availability and expiry, not file IDs or provider SIDs',()=>{
 const r=row();r.recording.fileId='private-file';r.recording.providerUrl='private-provider-url';const summary=publicVoiceRecording(r);assert.equal(summary.available,true);assert.doesNotMatch(JSON.stringify(summary),/private|REbbbb/);r.expiresAt=new Date(1);assert.equal(publicVoiceRecording(r).available,false);
 const draft=voicemailDraft('I want a wedding band',{...extracted,eventDateISO:'2028-12-14'});assert.equal(draft.eventDateISO,undefined);
 assert.match(VOICEMAIL_GREETING,/recorded and transcribed/);assert.match(VOICEMAIL_THANKS,/pilot test/);
});
