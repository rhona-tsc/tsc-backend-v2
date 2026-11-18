import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import twilio from 'twilio';
import {voiceCallRef} from '../services/voiceCallReview.js';
import {initializeGuidedIntake,readGuidedIntake,acceptGuidedAnswer,queueGuidedRecording,finalizeGuidedIntake,guidedTranscript} from '../services/voiceGuidedIntake.js';
import {selectGuidedRoute,prepareGuidedCallbackSlots,selectGuidedCallbackSlot,readGuidedCallbackTimes,upcomingCallbackDates} from '../services/voiceGuidedCallback.js';
import {guidedQuestionXml,publicGuidedRecording,publicGuidedReview} from '../services/voiceGuidedFlow.js';
import {appointmentSlots} from '../services/voiceAppointments.js';import {createVoiceEnquiryRouter} from '../routes/voiceEnquiryRoutes.js';
const sid=`CA${'f'.repeat(32)}`,account=`AC${'b'.repeat(32)}`,record=i=>`RE${i.toString(16).padStart(32,'0')}`,now=new Date('2026-11-18T09:00:00Z');
const get=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);
function set(obj,path,value){const keys=path.split('.');let target=obj;for(const key of keys.slice(0,-1))target=target[key]||={};target[keys.at(-1)]=structuredClone(value);}
function matches(row,filter){return Object.entries(filter).every(([key,value])=>{if(key==='$or')return value.some(v=>matches(row,v));const actual=get(row,key);if(value&&typeof value==='object'&&!(value instanceof Date))return Object.entries(value).every(([op,arg])=>op==='$exists'?(actual!==undefined)===arg:op==='$ne'?actual!==arg:op==='$gt'?actual>arg:op==='$lt'?actual<arg:op==='$in'?arg.includes(actual):false);return actual===value;});}
function memory(initial){const row=structuredClone(initial);return {row:()=>row,findOne:async filter=>matches(row,filter)?structuredClone(row):null,updateOne:async(filter,update)=>{if(!matches(row,filter))return {matchedCount:0};for(const [path,value]of Object.entries(update.$set||{}))set(row,path,value);for(const [path,value]of Object.entries(update.$inc||{}))set(row,path,(get(row,path)||0)+value);for(const path of Object.keys(update.$unset||{})){const keys=path.split('.');let target=row;for(const k of keys.slice(0,-1))target=target[k]||{};delete target[keys.at(-1)];}return {matchedCount:1};}};}
const fresh=()=>({_id:voiceCallRef(sid),callSid:sid,intent:'guided_enquiry',caller:'+447700900123',startedAt:new Date(),expiresAt:new Date(Date.now()+86400000)});
const config={base:'https://example.com'};
const data=step=>({CallSid:sid,AccountSid:account,RecordingSid:record(step+1),RecordingDuration:'12',Digits:'#'});
const lookup=async input=>({slots:appointmentSlots(input,{now,events:[]})});
async function callback(){const collection=memory(fresh());await initializeGuidedIntake(sid,{collection});await selectGuidedRoute(sid,'1',{collection});return collection;}

test('intro gives press one for a non-enquiry callback, while silence selects the normal enquiry path',async()=>{
 const collection=memory(fresh());let row=await initializeGuidedIntake(sid,{collection});const xml=guidedQuestionXml(row,config);
 assert.match(xml,/press 1 to arrange a callback/);assert.match(xml,/stay on the line/);assert.match(xml,/<Gather/);assert.doesNotMatch(xml,/<Record/);
 row=await selectGuidedRoute(sid,'',{collection});assert.equal(row.guided.kind,'enquiry');assert.match(guidedQuestionXml(row,config),/full name/);
 await selectGuidedRoute(sid,'1',{collection});assert.equal(collection.row().guided.kind,'enquiry'); // Retry cannot switch paths.
});

test('callback asks name, phone and brief reason, then offers checked slots rather than band questions',async()=>{
 const collection=await callback();let row=await prepareGuidedCallbackSlots(sid,{collection,lookup,now});
 assert.equal(row.guided.callback.phase,'ready');assert.equal(row.guided.callback.slots.length,3);
 for(let step=0;step<3;step++){
  const before=guidedQuestionXml(collection.row(),config);assert.doesNotMatch(before,/event date|venue name|music styles|quotes by email/);
  if(step===2)assert.match(before,/brief note explaining the reason/);
  row=await acceptGuidedAnswer(sid,step,data(step),{collection});
 }
 assert.equal(row.guided.status,'collecting');const xml=guidedQuestionXml(row,config);
 assert.match(xml,/currently free in the calendar/);assert.match(xml,/callback-choice\/[a-f0-9]{24}/);assert.doesNotMatch(xml,/<Record/);
 const menuId=row.guided.callback.menuId;
 row=await selectGuidedCallbackSlot(sid,menuId,'2',{collection,lookup,now});assert.equal(row.guided.status,'complete');assert.equal(row.guided.callback.phase,'selected');
 const end=guidedQuestionXml(row,config);assert.match(end,/reason for calling have been saved/);assert.match(end,/has not been booked/);assert.doesNotMatch(end,/<Record|<Gather/);
 await selectGuidedCallbackSlot(sid,menuId,'1',{collection,lookup,now});assert.equal(collection.row().guided.callback.selected.slotId,row.guided.callback.selected.slotId);
});

test('calendar failures offer a preferred-time recording and never invent an available time',async()=>{
 const collection=await callback();let row=await prepareGuidedCallbackSlots(sid,{collection,now,lookup:async()=>{throw Error('private calendar problem');}});
 assert.equal(row.guided.callback.phase,'preferred_time');assert.equal(row.guided.callback.slots,undefined);
 for(let i=0;i<3;i++)row=await acceptGuidedAnswer(sid,i,data(i),{collection});
 assert.match(guidedQuestionXml(row,config),/preferred day and time/);assert.doesNotMatch(guidedQuestionXml(row,config),/currently free|private calendar/);
 row=await acceptGuidedAnswer(sid,3,data(3),{collection});assert.equal(row.guided.status,'complete');assert.equal(row.guided.callback.selected,undefined);
});

test('selection rechecks availability, stale menus cannot select a different slot, and later options exclude earlier ones',async()=>{
 const collection=await callback();let row=await prepareGuidedCallbackSlots(sid,{collection,lookup,now}),oldId=row.guided.callback.menuId,first=row.guided.callback.slots[0];await collection.updateOne({_id:voiceCallRef(sid)},{$set:{'guided.step':3,'guided.callback.answersReady':true}});
 row=await selectGuidedCallbackSlot(sid,oldId,'1',{collection,now,lookup:async()=>({slots:[]})});assert.equal(row.guided.status,'collecting');assert.equal(row.guided.callback.phase,'loading');assert.equal(row.guided.callback.selected,undefined);
 row=await prepareGuidedCallbackSlots(sid,{collection,lookup,now});const newId=row.guided.callback.menuId;assert.notEqual(newId,oldId);
 await selectGuidedCallbackSlot(sid,oldId,'1',{collection,lookup,now});assert.equal(collection.row().guided.callback.selected,undefined);
 const last=row.guided.callback.slots.at(-1).startISO;await selectGuidedCallbackSlot(sid,newId,'4',{collection,lookup,now});row=await prepareGuidedCallbackSlots(sid,{collection,lookup,now});assert.ok(row.guided.callback.slots.every(slot=>slot.startISO>last));assert.notEqual(row.guided.callback.slots[0].slotId,first.slotId);
});

test('unanswered menu and calendar waiting are bounded and do not reserve any slot',async()=>{
 const collection=await callback();await prepareGuidedCallbackSlots(sid,{collection,lookup,now});await collection.updateOne({_id:voiceCallRef(sid)},{$set:{'guided.step':3,'guided.callback.answersReady':true}});let row=collection.row(),id=row.guided.callback.menuId;
 await selectGuidedCallbackSlot(sid,id,'',{collection,lookup,now});row=await selectGuidedCallbackSlot(sid,id,'9',{collection,lookup,now});assert.equal(row.guided.callback.phase,'preferred_time');assert.equal(row.guided.callback.selected,undefined);
 const waiting=await callback();for(let i=0;i<10;i++)row=await readGuidedCallbackTimes(sid,{collection:waiting});assert.equal(row.guided.callback.phase,'preferred_time');
 assert.ok(upcomingCallbackDates(new Date('2027-03-26T11:00:00Z')).every(date=>[1,2,3,4].includes(new Date(date).getUTCDay())));
});

test('brief reason, preferred callback and private recordings survive processing as a callback draft with one management notification',async()=>{
 const collection=await callback();await prepareGuidedCallbackSlots(sid,{collection,lookup,now});let row=collection.row();await collection.updateOne({_id:voiceCallRef(sid)},{$set:{'guided.step':3,'guided.callback.answersReady':true}});
 row=await selectGuidedCallbackSlot(sid,row.guided.callback.menuId,'1',{collection,lookup,now});
 row.guided.answers={name:{transcript:'Mary Example',status:'stored',fileId:'private-name'},phone:{transcript:'Use this number please',status:'stored'},callback_reason:{transcript:'I am a musician asking about a job advert.',status:'stored',fileId:'private-reason'}};let draft,appointment,notifications=0;
 await finalizeGuidedIntake(row,{collection,extract:async()=>{throw Error('optional interpretation unavailable');},saveDraft:async(id,value)=>{draft=value;},saveConsent:async()=>{},saveAppointment:async(id,value)=>{appointment=value;},lookupBands:async()=>{throw Error('Do not look up bands for a callback');},finish:async()=>{notifications++;}});
 assert.equal(draft.enquiryTopic,'human_callback');assert.match(draft.callbackReason,/musician asking/);assert.match(draft.requirements,/Reason for the call/);assert.equal(draft.clientPhone,'+447700900123');assert.equal(appointment.bookingConfirmed,false);assert.equal(appointment.testMode,true);assert.equal(notifications,1);
 assert.match(guidedTranscript(row),/Reason for the call/);assert.ok(publicGuidedRecording(row).parts.some(p=>p.key==='callback_reason'));assert.doesNotMatch(JSON.stringify(publicGuidedReview(row)),/private-reason|private-name|CAffff/);
});

test('signed menu and choice endpoints reject unsigned or wrong-account requests and never create phone calls or calendar events',async()=>{
 const settings={VOICE_ENQUIRY_ENABLED:'true',VOICE_ENQUIRY_MODE:'guided',VOICE_ENQUIRY_PUBLIC_BASE_URL:'https://example.com',TWILIO_AUTH_TOKEN:'test-token',TWILIO_ACCOUNT_SID:account};const previous=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]]));Object.assign(process.env,settings);
 const collection=memory(fresh());await initializeGuidedIntake(sid,{collection});let lookups=0;
 const app=express();app.use('/api/voice-enquiries',createVoiceEnquiryRouter({guided:{read:id=>readGuidedIntake(id,{collection})},callback:{route:(id,digit)=>selectGuidedRoute(id,digit,{collection}),prepare:async id=>{lookups++;return prepareGuidedCallbackSlots(id,{collection,lookup,now});},times:id=>readGuidedCallbackTimes(id,{collection}),select:(id,menu,digit)=>selectGuidedCallbackSlot(id,menu,digit,{collection,lookup,now})}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const endpoint='/api/voice-enquiries/twilio/guided/route';
 const post=(body,signed=true)=>fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method:'POST',body:new URLSearchParams(body),headers:signed?{'X-Twilio-Signature':twilio.getExpectedTwilioSignature(settings.TWILIO_AUTH_TOKEN,`https://example.com${endpoint}`,body)}:{}});
 try{assert.equal((await post({...data(0),Digits:'1'},false)).status,403);assert.equal((await post({...data(0),Digits:'1',AccountSid:'wrong'})).status,403);assert.equal(lookups,0);const response=await post({...data(0),Digits:'1'});assert.equal(response.status,200);assert.match(await response.text(),/full name/);assert.equal(collection.row().guided.kind,'callback');assert.ok(lookups>0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));for(const [k,v]of Object.entries(previous))v===undefined?delete process.env[k]:process.env[k]=v;}
});


test('calendar choices cannot finish a call before contact and brief reason questions have been reached',async()=>{
 const collection=await callback();let row=await prepareGuidedCallbackSlots(sid,{collection,lookup,now});const menu=row.guided.callback.menuId;
 row=await selectGuidedCallbackSlot(sid,menu,'1',{collection,lookup,now});assert.equal(row.guided.status,'collecting');assert.equal(row.guided.callback.selected,undefined);
});
