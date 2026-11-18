import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import twilio from 'twilio';
import {reserveLiveVoiceCall,liveVoiceBudgetStatus,voiceBudgetMonth} from '../services/voiceLiveBudget.js';
import {bookLiveVoiceCallback,voiceCallbackEventId,liveCallbackContact} from '../services/voiceCalendarBooking.js';
import {enforceLiveVoiceDuration} from '../services/voiceLiveCall.js';
import {voiceCallRef,managementCallEmail} from '../services/voiceCallReview.js';
import {voiceConnectionConfig} from '../services/voiceEnquiryConnection.js';
import {guidedClosing,publicGuidedReview} from '../services/voiceGuidedFlow.js';
import {saveVoiceDraft} from '../services/voiceEnquiryStore.js';import {createVoiceEnquiryRouter} from '../routes/voiceEnquiryRoutes.js';
const sid=n=>`CA${n.toString(16).padStart(32,'0')}`;
function meter(){const rows=new Map();const matches=(r,f)=>r&&Object.entries(f).every(([k,v])=>v?.$lte!==undefined?r[k]<=v.$lte:v?.$ne!==undefined?!r[k]?.includes(v.$ne):Array.isArray(r[k])?r[k].includes(v):r[k]===v);return {rows,updateOne:async(f,u)=>{if(!rows.has(f._id))rows.set(f._id,{_id:f._id,...structuredClone(u.$setOnInsert)});},findOne:async f=>{const r=rows.get(f._id);return matches(r,f)?structuredClone(r):null;},findOneAndUpdate:async(f,u)=>{const r=rows.get(f._id);if(!matches(r,f))return null;for(const [k,v]of Object.entries(u.$inc||{}))r[k]=(r[k]||0)+v;for(const[k,v]of Object.entries(u.$push||{}))r[k].push(v);return structuredClone(r);}};}
test('monthly £10 allowance is atomic across concurrent calls and provider retries, with no pilot meter reset',async()=>{
 const collection=meter(),base={projectId:'proj_live',now:new Date('2026-11-18'),collection};const outcomes=await Promise.all(Array.from({length:30},(_,i)=>reserveLiveVoiceCall({...base,callSid:sid(i)})));assert.equal(outcomes.filter(Boolean).length,10);assert.equal(await reserveLiveVoiceCall({...base,callSid:sid(0)}),true);assert.equal(await reserveLiveVoiceCall({...base,callSid:sid(99)}),false);
 const status=await liveVoiceBudgetStatus(base);assert.equal(status.limitPence,1000);assert.equal(status.reservedPence,1000);assert.equal(status.acceptedCalls,10);assert.equal(status.actualCharges,null);assert.equal(status.remainingReservations,0);assert.equal(collection.rows.size,1);
 assert.equal(await reserveLiveVoiceCall({...base,now:new Date('2026-12-01'),callSid:sid(99)}),true);assert.equal(collection.rows.size,2);assert.equal(voiceBudgetMonth(new Date('2027-05-31T23:30:00Z')),'2027-06');
 assert.equal(await reserveLiveVoiceCall({...base,callSid:sid(100),collection:{updateOne:async()=>{throw Error('offline');}}}),false);
});

test('live mode is opt-in, guided-only, dedicated-number-only and independent of the expired pilot allowance',()=>{
 const env={VOICE_ENQUIRY_ENABLED:'true',VOICE_ENQUIRY_LIVE_ENABLED:'true',VOICE_ENQUIRY_PUBLIC_BASE_URL:'https://example.com',VOICE_ENQUIRY_TWILIO_NUMBER:'+447453423200',OPENAI_VOICE_API_KEY:'test',TWILIO_AUTH_TOKEN:'test',VOICE_ENQUIRY_PROJECT_ID:'proj_live'};
 assert.equal(voiceConnectionConfig(env).live,true);assert.equal(voiceConnectionConfig(env).ready,true);
 assert.equal(voiceConnectionConfig({...env,VOICE_ENQUIRY_MODE:'conversation'}).ready,false);assert.equal(voiceConnectionConfig({...env,VOICE_ENQUIRY_MODE:'voicemail'}).ready,false);assert.equal(voiceConnectionConfig({...env,VOICE_ENQUIRY_TWILIO_NUMBER:'+447700900999'}).ready,false);assert.equal(voiceConnectionConfig({...env,VOICE_ENQUIRY_LIVE_ENABLED:'false'}).ready,false);
});

test('public ingress checks signatures and target number, reserves live allowance rather than a test call and rejects unbudgeted calls before answer',async()=>{
 const settings={VOICE_ENQUIRY_ENABLED:'true',VOICE_ENQUIRY_LIVE_ENABLED:'true',VOICE_ENQUIRY_MODE:'guided',VOICE_ENQUIRY_PUBLIC_BASE_URL:'https://example.com',VOICE_ENQUIRY_TWILIO_NUMBER:'+447453423200',OPENAI_VOICE_API_KEY:'unused',TWILIO_AUTH_TOKEN:'test-token',VOICE_ENQUIRY_PROJECT_ID:'proj_live'};const previous=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]]));Object.assign(process.env,settings);
 let budget=true,reservations=0,pilot=0,created;const app=express();app.use('/api/voice-enquiries',createVoiceEnquiryRouter({readIntake:async()=>null,reserveLiveCall:async()=>{reservations++;return budget;},reservePilotCall:async()=>{pilot++;return false;},startReview:async data=>{created=data;},guided:{initialize:async id=>({_id:voiceCallRef(id),callSid:id,startedAt:new Date(),testMode:false,guided:{version:3,route:'menu',status:'collecting',step:0}})}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const endpoint='/api/voice-enquiries/twilio/incoming',body={CallSid:sid(2),From:'+447700900999',To:'+447453423200'};
 const post=(data,signed=true)=>fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method:'POST',body:new URLSearchParams(data),headers:signed?{'X-Twilio-Signature':twilio.getExpectedTwilioSignature('test-token',`https://example.com${endpoint}`,data)}:{}});
 try{assert.equal((await post(body,false)).status,403);const wrong=await(await post({...body,To:'+447700900998'})).text();assert.match(wrong,/<Response><Reject/);assert.equal(reservations,0);budget=false;assert.match(await(await post(body)).text(),/<Response><Reject/);assert.equal(created,undefined);budget=true;const xml=await(await post(body)).text();assert.match(xml,/press 1 to arrange a callback/);assert.doesNotMatch(xml,/pilot test|<Sip/);assert.equal(created.testMode,false);assert.equal(pilot,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));for(const[k,v]of Object.entries(previous))v===undefined?delete process.env[k]:process.env[k]=v;}
});

const slot={slotId:'a'.repeat(24),startISO:'2026-11-19T10:00:00.000Z',endISO:'2026-11-19T10:20:00.000Z',label:'Thursday 19/11/2026 at 10:00 UK time'};
function bookingRow(n=1){return {_id:voiceCallRef(sid(n)),callSid:sid(n),caller:'+447700900123',testMode:false,guided:{kind:'callback',answers:{name:{transcript:'Mary Example'},phone:{transcript:'Use this number please'},callback_reason:{transcript:'Discuss an existing booking.'}},callback:{phase:'booking',selected:slot}}};}
function bookingDeps(){let event,holder,inserts=0;const updates=[];return {updates,get inserts(){return inserts;},events:{get:async()=>{if(!event)throw {code:404};return {data:structuredClone(event)};},insert:async params=>{inserts++;assert.equal(params.sendUpdates,'none');assert.equal(params.calendarId,'rhona@thesupremecollective.co.uk');assert.equal(params.requestBody.visibility,'private');assert.equal(params.requestBody.attendees,undefined);event={...params.requestBody,status:'confirmed'};return {data:event};}},claims:{findOneAndUpdate:async(f,u)=>holder||=(u.$setOnInsert)},calls:{updateOne:async(f,u)=>updates.push(u)},lookup:async()=>({slots:[slot]}),liveEnabled:true,now:new Date('2026-11-18')};}

test('live calendar booking uses a deterministic owned event, rechecks the slot, never invites attendees and safely reuses retries',async()=>{
 const row=bookingRow(),deps=bookingDeps();const result=await bookLiveVoiceCallback(row,deps);assert.equal(result.status,'booked');assert.equal(result.eventId,voiceCallbackEventId(row.callSid));assert.equal(deps.inserts,1);assert.ok(deps.updates.some(u=>u.$set?.['guided.callback.bookingAttempted']));
 const retry=await bookLiveVoiceCallback(row,deps);assert.equal(retry.status,'booked');assert.equal(retry.reused,true);assert.equal(deps.inserts,1);
 const other=bookingRow(2);const blocked=await bookLiveVoiceCallback(other,{...deps,events:{get:async()=>{throw {code:404};},insert:async()=>{throw Error('Must not insert for an already claimed slot');}}});assert.equal(blocked.status,'unavailable');
});

test('test calls, unavailable slots, missing consent and uncertain insert outcomes cannot produce false booking confirmations',async()=>{
 const deps=bookingDeps();await assert.rejects(bookLiveVoiceCallback({...bookingRow(),testMode:true},deps),/not enabled/);assert.equal(deps.inserts,0);
 const unavailable=await bookLiveVoiceCallback(bookingRow(),{...deps,lookup:async()=>({slots:[]})});assert.equal(unavailable.status,'unavailable');assert.equal(deps.inserts,0);
 const declined=bookingRow();declined.guided.answers.callback_reason.transcript="Please don't call me";assert.deepEqual(liveCallbackContact(declined),{});assert.equal((await bookLiveVoiceCallback(declined,deps)).status,'needs_review');
 const uncertain=bookingRow();uncertain.guided.callback.bookingAttempted=true;assert.equal((await bookLiveVoiceCallback(uncertain,deps)).status,'needs_review');assert.equal(deps.inserts,0);
 const pending=bookingRow();pending.guided.answers.phone={status:'queued'};assert.equal((await bookLiveVoiceCallback(pending,deps)).status,'waiting_for_contact');
});

test('existing provider duration limit is applied without placing a call, and test calls never mutate provider settings',async()=>{
 const row=bookingRow(),updates=[];let requests=0;const options={collection:{updateOne:async(f,u)=>updates.push(u)},update:async id=>{requests++;assert.equal(id,row.callSid);}};
 assert.equal(await enforceLiveVoiceDuration({...row,testMode:true},options),true);assert.equal(requests,0);assert.equal(await enforceLiveVoiceDuration(row,options),true);assert.equal(requests,1);assert.equal(updates[0].$set['guided.durationLimitSet'],true);assert.equal(await enforceLiveVoiceDuration(row,{...options,update:async()=>{throw Error('provider');}}),false);
});

test('real drafts and management summaries have live labels while remaining unconfirmed, with no test wording or false appointment claim',async()=>{
 let saved;await saveVoiceDraft(sid(1),{clientName:'Mary'}, {testMode:false,Model:{findOneAndUpdate:async(f,u)=>{saved=u;return u;}}});assert.equal(saved.$set.marketingSource,'Phone — AI assistant');assert.equal(saved.$set.captureState,'draft');assert.equal(saved.$set.contactConfirmed,false);assert.doesNotMatch(saved.$set.notes,/PILOT TEST/);
 const row={...bookingRow(),startedAt:new Date(),status:'guided_answers_saved'},email=managementCallEmail(row,{clientName:'Mary',captureState:'draft',callAppointment:{...slot,status:'booked',testMode:false}});assert.match(email.subject,/\[AI call\]/);assert.doesNotMatch(email.text,/AI PHONE PILOT TEST|test proposal; not booked/);assert.match(email.text,/booked in the callback calendar/);
 row.guided.callback.booking={status:'needs_review'};assert.doesNotMatch(guidedClosing(row),/is booked|pilot test/);row.guided.callback.booking={status:'booked'};assert.match(guidedClosing(row),/callback is booked/);
});

test('callback review reflects only a calendar-confirmed live booking',()=>{
 const row=bookingRow();row.guided.answers={};assert.equal(publicGuidedReview(row).callback.bookingConfirmed,false);row.guided.callback.booking={status:'booked'};assert.equal(publicGuidedReview(row).callback.bookingConfirmed,true);assert.equal(publicGuidedReview({...row,testMode:true}).callback.bookingConfirmed,false);
});
