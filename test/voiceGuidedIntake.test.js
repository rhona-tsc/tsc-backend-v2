import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import twilio from 'twilio';
import {createVoiceEnquiryRouter} from '../routes/voiceEnquiryRoutes.js';
import {voiceCallRef,managementCallEmail} from '../services/voiceCallReview.js';
import {voiceConnectionConfig} from '../services/voiceEnquiryConnection.js';
import {GUIDED_QUESTIONS,guidedQuestionXml,guidedClosing,guidedConsent,publicGuidedReview,publicGuidedRecording} from '../services/voiceGuidedFlow.js';
import {initializeGuidedIntake,readGuidedIntake,acceptGuidedAnswer,acceptGuidedConsent,queueGuidedRecording,closeGuidedIntake,processGuidedAnswer,finalizeGuidedIntake,literalGuidedFields} from '../services/voiceGuidedIntake.js';
const sid=`CA${'a'.repeat(32)}`,account=`AC${'b'.repeat(32)}`,record=i=>`RE${i.toString(16).padStart(32,'0')}`;
const get=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);
function set(obj,path,value){const keys=path.split('.');let target=obj;for(const k of keys.slice(0,-1))target=target[k]||=( {} );target[keys.at(-1)]=structuredClone(value);}
function match(row,filter){return Object.entries(filter).every(([key,value])=>{const actual=get(row,key);if(value&&typeof value==='object'&&!(value instanceof Date))return Object.entries(value).every(([op,arg])=>op==='$exists'?(actual!==undefined)===arg:op==='$ne'?actual!==arg:op==='$gt'?actual>arg:false);return actual===value;});}
function memory(initial){let row=structuredClone(initial);return {row:()=>row,findOne:async filter=>match(row,filter)?structuredClone(row):null,updateOne:async(filter,update)=>{if(!match(row,filter))return {matchedCount:0};for(const [path,value]of Object.entries(update.$set||{}))set(row,path,value);for(const [path,value]of Object.entries(update.$inc||{}))set(row,path,(get(row,path)||0)+value);return {matchedCount:1};}};}
function fresh(){return {_id:voiceCallRef(sid),callSid:sid,caller:'+447700900123',intent:'guided_enquiry',startedAt:new Date(),expiresAt:new Date(Date.now()+86400000),notificationStatus:'pending'};}
const settings={VOICE_ENQUIRY_ENABLED:'true',VOICE_ENQUIRY_PUBLIC_BASE_URL:'https://example.com',VOICE_ENQUIRY_TWILIO_NUMBER:'+447700900100',OPENAI_VOICE_API_KEY:'test-unused-key',OPENAI_VOICE_WEBHOOK_SECRET:'test-unused-secret',TWILIO_AUTH_TOKEN:'test-token',TWILIO_ACCOUNT_SID:account,VOICE_ENQUIRY_BRIDGE_SECRET:'test-only-secret-at-least-32-characters',VOICE_ENQUIRY_PROJECT_ID:'proj_example',VOICE_ENQUIRY_TEST_CALLERS:'+447700900123',VOICE_ENQUIRY_TEST_END_AT:new Date(Date.now()+3600000).toISOString(),VOICE_ENQUIRY_MODE:'guided'};
const env=()=>{const before=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]]));Object.assign(process.env,settings);return()=>{for(const [k,v]of Object.entries(before))v===undefined?delete process.env[k]:process.env[k]=v;};};
const body=(i,digits='#')=>({CallSid:sid,AccountSid:account,From:'+447700900123',To:'+447700900100',RecordingSid:record(i+1),RecordingDuration:'12',Digits:digits});

test('guided flow is the default, asks exactly one question, has no silence-based advance or live model turn',()=>{
 assert.equal(voiceConnectionConfig({}).mode,'guided');
 const row={...fresh(),guided:{status:'collecting',step:0,answers:{}}};
 const xml=guidedQuestionXml(row,{base:'https://example.com'},{opening:true});
 assert.equal((xml.match(/<Record /g)||[]).length,1);assert.match(xml,/full name/);assert.doesNotMatch(xml,/Please tell me your email|<Sip|<Dial|<Gather/);
 assert.match(xml,/recorded and transcribed/);assert.match(xml,/timeout="0"/);assert.match(xml,/finishOnKey="#"/);assert.match(xml,/Polly.Amy/);assert.match(xml,/guided\/answer\/0#/);assert.ok(xml.length<4096);
});

test('signed complete call advances in order; action retries, callback races and restarts cannot skip or replace answers',async()=>{
 const restore=env(),collection=memory(fresh());let reserved=0,started=0;
 const guided={initialize:id=>initializeGuidedIntake(id,{collection}),read:id=>readGuidedIntake(id,{collection}),answer:(id,step,data)=>acceptGuidedAnswer(id,step,data,{collection}),consent:(id,digit)=>acceptGuidedConsent(id,digit,{collection}),recording:(id,step,data)=>queueGuidedRecording(id,step,data,{collection}),close:id=>closeGuidedIntake(id,'interrupted',{collection})};
 const app=express();app.use('/api/voice-enquiries',createVoiceEnquiryRouter({guided,readIntake:async()=>started?structuredClone(collection.row()):null,startReview:async()=>{started++;},reservePilotCall:async()=>{reserved++;return true;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const post=async(path,data,signed=true)=>{const endpoint=`/api/voice-enquiries/twilio/${path}`;return fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method:'POST',body:new URLSearchParams(data),headers:signed?{'X-Twilio-Signature':twilio.getExpectedTwilioSignature(settings.TWILIO_AUTH_TOKEN,`https://example.com${endpoint}`,data)}:{}});};
 try{
  const ingress=body(0);assert.equal((await post('incoming',ingress,false)).status,403);
  assert.doesNotMatch(await(await post('incoming',{...ingress,From:'+447700900999'})).text(),/<Record/);assert.equal(reserved,0);
  const first=await(await post('incoming',ingress)).text();assert.match(first,/full name/);assert.equal(reserved,1);
  const retried=await(await post('incoming',ingress)).text();assert.match(retried,/full name/);assert.match(retried,/recorded and transcribed/);assert.equal(reserved,1);
  for(let step=0;step<GUIDED_QUESTIONS.length;step++){
   const data=body(step);const callback={...data,RecordingStatus:'completed'};
   assert.equal((await post(`guided/recording/${step}`,callback,false)).status,403);
   assert.equal((await post(`guided/recording/${step}`,{...callback,AccountSid:'wrong'})).status,403);
   assert.equal((await post(`guided/recording/${step}`,callback)).status,200); // May arrive before Record action.
   assert.equal(collection.row().guided.step,step);
   const next=await post(`guided/answer/${step}`,data);assert.equal(next.status,200);const xml=await next.text();
   assert.equal(collection.row().guided.step,step+1);
   assert.match(xml,step<6?new RegExp(`guided/answer/${step+1}#`):/may we email you quotes/);
   assert.equal((await post(`guided/answer/${step}`,data)).status,200);assert.equal(collection.row().guided.step,step+1);
   assert.equal((await post(`guided/recording/${step}`,{...callback,RecordingSid:record(99)})).status,404);
  }
  const ending=await(await post('guided/consent',{...ingress,Digits:'3'})).text();
  assert.match(ending,/phone follow-up only/);assert.match(ending,/pilot test/);assert.doesNotMatch(ending,/<Record|<Gather|send confirmed availability|all the information/);
  assert.equal(collection.row().guided.status,'complete');assert.deepEqual(collection.row().guided.consent.emailQuotes,false);assert.equal(collection.row().guided.consent.phoneFollowup,true);
  await post('guided/consent',{...ingress,Digits:'1'});assert.equal(collection.row().guided.consent.emailQuotes,false);assert.equal(reserved,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));restore();}
});

test('hangup keeps the answer, closes an incomplete draft and never infers permission',async()=>{
 const collection=memory(fresh());await initializeGuidedIntake(sid,{collection});
 const row=await acceptGuidedAnswer(sid,0,body(0,'hangup'),{collection});
 assert.equal(row.guided.status,'interrupted');assert.equal(row.guided.answers.name.sid,record(1));assert.equal(row.guided.consent,undefined);assert.doesNotMatch(guidedClosing(row),/all the information|inbox/);
});

test('unknown steps, mismatched calls and out-of-order actions cannot record data in the wrong section',async()=>{
 const collection=memory(fresh());await initializeGuidedIntake(sid,{collection});
 assert.equal(await queueGuidedRecording(sid,1,{...body(1),RecordingStatus:'completed'},{collection}),false);
 assert.equal(await queueGuidedRecording(sid,0,{...body(0),CallSid:'wrong',RecordingStatus:'completed'},{collection}),false);
 assert.equal(await queueGuidedRecording(sid,0,{...body(0),RecordingDuration:'1000',RecordingStatus:'completed'},{collection}),false);
 const row=await acceptGuidedAnswer(sid,2,body(2),{collection});assert.equal(row.guided.step,0);assert.deepEqual(row.guided.answers,{});
});

test('permissions are explicit per channel; invalid or missing keys never mean yes',async()=>{
 assert.deepEqual(guidedConsent('4'),{emailQuotes:false,phoneFollowup:false,method:'keypad',choice:'4'});assert.equal(guidedConsent('yes'),null);
 const row={...fresh(),guided:{status:'collecting',step:7,answers:{},consentAttempts:0}},collection=memory(row);
 assert.equal((await acceptGuidedConsent(sid,'',{collection})).guided.status,'collecting');
 const closed=await acceptGuidedConsent(sid,'9',{collection});assert.equal(closed.guided.status,'interrupted');assert.equal(closed.guided.consent,undefined);
});

test('answer processing stores original private audio before provider cleanup; failed transcription keeps it',async()=>{
 const row={...fresh(),guided:{answers:{email:{sid:record(1),status:'queued',attempts:3}}}},collection=memory(row),events=[];
 assert.equal(await processGuidedAnswer(row,'email',{collection,download:async()=>{events.push('download');return Buffer.from('audio');},storeAudio:async ref=>{assert.equal(ref,`${row._id}:email`);events.push('store');return 'private-file';},removeCopy:async()=>{events.push('remove');return true;},transcribe:async()=>{throw Error('private error');}}),false);
 assert.deepEqual(events,['download','store','remove']);assert.equal(collection.row().guided.answers.email.fileId,'private-file');assert.equal(collection.row().guided.answers.email.status,'needs_review');
});

test('finished guided draft retains contact choices and caller-number request, without qualifying, selecting bands or sending requests',async()=>{
 const row={...fresh(),guided:{status:'complete',consent:{emailQuotes:false,phoneFollowup:true,method:'keypad'},answers:{name:{transcript:'Mary Example',status:'stored'},phone:{transcript:'Use this number please',status:'stored'},email:{transcript:'No email',status:'stored'},event_date:{transcript:'14 July 2028',status:'stored'},location:{transcript:'London',status:'stored'},preferences:{transcript:'Soul band with saxophone for 4000 pounds',status:'stored'},extras:{transcript:'Band member DJ set',status:'stored'}}}},collection=memory(row);let saved,permission,notifications=0;
 const result=await finalizeGuidedIntake(row,{collection,extract:async()=>({clientName:'Mary Example',clientPhone:'',clientEmail:'',eventDateISO:'2028-07-14',address:'London',styles:['Soul'],mustHaveInstruments:['Saxophone'],maxBudget:4000,topic:'client_event',notes:'Band member DJ set'}),saveDraft:async(id,draft)=>{saved=draft;},saveConsent:async(id,consent)=>{permission=consent;},lookupBands:async()=>({bands:[{actId:'one',name:'Example Soul Band'}]}),finish:async(id,options)=>{notifications++;assert.equal(options.status,'guided_answers_saved');}});
 assert.equal(result,true);assert.equal(saved.clientPhone,'+447700900123');assert.equal(saved.preferredContactMethod,'phone');assert.equal(saved.eventDateISO,'2028-07-14');assert.equal(saved.maxBudget,4000);assert.equal(saved.selectedBands,undefined);assert.equal(saved.confirmed,undefined);assert.equal(permission.emailQuotes,false);assert.equal(permission.phoneFollowup,true);assert.equal(notifications,1);assert.equal(collection.row().voicemail.messagesSent,0);
});

test('partial answer processing cannot invent missing contact details, consent or event date',async()=>{
 const row={...fresh(),guided:{status:'interrupted',answers:{name:{transcript:'Mary',status:'stored'}}}},collection=memory(row);let saved,consent;
 await finalizeGuidedIntake(row,{collection,extract:async()=>({clientName:'Mary',clientEmail:'invented@example.com',clientPhone:'07700900123',eventDateISO:'2028-07-14',address:'London',topic:'other'}),saveDraft:async(id,draft)=>{saved=draft;},saveConsent:async(id,value)=>{consent=value;},finish:async(id,options)=>assert.equal(options.status,'guided_partial_saved')});
 for(const key of ['clientEmail','clientPhone','eventDateISO','address'])assert.equal(saved[key],undefined);assert.equal(consent.emailQuotes,false);assert.equal(consent.phoneFollowup,false);
});

test('public call review and playback choices never leak provider IDs or private file identifiers',()=>{
 const row={...fresh(),guided:{status:'interrupted',step:1,answers:{name:{sid:record(1),fileId:'private-file',status:'stored',durationSeconds:7}}}};
 const result={guided:publicGuidedReview(row),recording:publicGuidedRecording(row)};
 assert.equal(result.recording.parts[0].key,'name');assert.equal(result.recording.available,true);assert.doesNotMatch(JSON.stringify(result),/private-file|RE000|CAaaaa/);
 const email=managementCallEmail({...row,status:'guided_partial_saved',voicemail:{status:'ready_for_review'}},null);assert.equal(email.to,'hello@thesupremecollective.co.uk');assert.match(email.text,/email quotes not completed/);assert.match(email.text,/Private audio/);
});

test('an empty recorded answer is marked missing and # still moves on without inventing its contents',async()=>{
 const collection=memory(fresh());await initializeGuidedIntake(sid,{collection});
 await queueGuidedRecording(sid,0,{CallSid:sid,RecordingStatus:'absent'},{collection});
 const data=body(0);delete data.RecordingSid;
 const row=await acceptGuidedAnswer(sid,0,data,{collection});assert.equal(row.guided.step,1);assert.equal(row.guided.answers.name.status,'absent');
});

test('temporary storage errors return a small retryable XML response rather than an application error',async()=>{
 const restore=env(),app=express();let reserved=0;
 app.use('/api/voice-enquiries',createVoiceEnquiryRouter({readIntake:async()=>{throw Error('private storage details');},reservePilotCall:async()=>{reserved++;return true;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const endpoint='/api/voice-enquiries/twilio/incoming',data=body(0);
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method:'POST',body:new URLSearchParams(data),headers:{'X-Twilio-Signature':twilio.getExpectedTwilioSignature(settings.TWILIO_AUTH_TOKEN,`https://example.com${endpoint}`,data)}});const xml=await response.text();assert.equal(response.status,503);assert.ok(xml.length<1024);assert.doesNotMatch(xml,/private storage|<Record/);assert.equal(reserved,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));restore();}
});


test('an interpretation outage still saves literal contact, event and budget fields and notifies management for review',async()=>{
 const row={...fresh(),guided:{status:'complete',consent:{emailQuotes:true,phoneFollowup:false},answers:{name:{transcript:'My full name is Mary Example.',status:'stored'},phone:{transcript:'07700 900123',status:'stored'},email:{transcript:'mary dot example at example dot com',status:'stored'},event_date:{transcript:'14 July 2028',status:'stored'},location:{transcript:'Example Hall, Berkshire, RG1 1AA',status:'stored'},preferences:{transcript:'A 6-piece Soul band with saxophone, budget £4,000',status:'stored'},extras:{transcript:'A DJ add-on please',status:'stored'}}}},collection=memory(row);let saved,finished=0;
 assert.equal(literalGuidedFields(row).clientEmail,'mary.example@example.com');
 await finalizeGuidedIntake(row,{collection,extract:async()=>{throw Error('unavailable');},saveDraft:async(id,draft)=>{saved=draft;},saveConsent:async()=>{},lookupBands:async()=>{throw Error('No guesses on interpreter failure');},finish:async()=>{finished++;}});
 assert.equal(saved.clientName,'Mary Example');assert.equal(saved.clientEmail,'mary.example@example.com');assert.equal(saved.clientPhone,'+447700900123');assert.equal(saved.eventDateISO,'2028-07-14');assert.equal(saved.maxBudget,4000);assert.match(saved.address,/Example Hall/);assert.match(saved.requirements,/DJ add-on/);assert.equal(finished,1);assert.equal(collection.row().guided.interpretationStatus,'needs_review');assert.match(collection.row().voicemail.lastError,/original recordings are saved/);
});
