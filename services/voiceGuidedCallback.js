import {bookLiveVoiceCallback} from './voiceCalendarBooking.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {voiceCallRef} from './voiceCallReview.js';
import {lookupVoiceCallSlots} from './voiceAppointments.js';
const calls=()=>mongoose.connection.db.collection('voice_call_reviews');
const filter=sid=>({_id:voiceCallRef(sid),intent:'guided_enquiry',expiresAt:{$gt:new Date()}});
const get=(sid,collection)=>/^CA[a-f\d]{32}$/i.test(sid||'')?collection.findOne(filter(sid),{maxTimeMS:1500}):null;
export async function selectGuidedRoute(sid,digit,{collection=calls()}={}){
  const row=await get(sid,collection);if(!row||row.guided.version<3||row.guided.route!=='menu'||row.guided.status!=='collecting')return row;
  const kind=digit==='1'?'callback':'enquiry';
  await collection.updateOne({...filter(sid),'guided.route':'menu'},{$set:{'guided.route':'selected','guided.kind':kind,...(kind==='callback'?{'guided.callback':{phase:'loading',menuAttempts:0}}:{})}},{maxTimeMS:1500});
  return get(sid,collection);
}
export function upcomingCallbackDates(now=new Date()){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const noon=new Date(`${date}T12:00:00Z`),dates=[];
  for(let i=0;i<14&&dates.length<6;i++){const day=new Date(+noon+i*86400000);if([1,2,3,4].includes(day.getUTCDay()))dates.push(day.toISOString().slice(0,10));}
  return dates;
}
const spoken=iso=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso));
export async function prepareGuidedCallbackSlots(sid,{collection=calls(),lookup=lookupVoiceCallSlots,now=new Date()}={}){
  const row=await get(sid,collection);if(!row||row.guided.kind!=='callback'||row.guided.status!=='collecting'||row.guided.callback?.phase!=='loading')return row;
  const claim=await collection.updateOne({...filter(sid),'guided.callback.phase':'loading',$or:[{'guided.callback.lookupUntil':{$exists:false}},{'guided.callback.lookupUntil':{$lt:now}}]},{$set:{'guided.callback.lookupUntil':new Date(+now+45000)}},{maxTimeMS:1500});
  if(!claim.matchedCount)return get(sid,collection);
  try{
    const options=[];
    for(const dateISO of upcomingCallbackDates(now)){
      const result=await lookup({dateISO},{now,timeoutMs:2500});
      for(const slot of result.slots||[]){
        if(!/^[a-f\d]{24}$/i.test(slot.slotId||'')||!Number.isFinite(+new Date(slot.startISO))||!Number.isFinite(+new Date(slot.endISO)))continue;
        if(row.guided.callback.afterStartISO&&slot.startISO<=row.guided.callback.afterStartISO)continue;
        options.push({slotId:slot.slotId,startISO:slot.startISO,endISO:slot.endISO,label:slot.label,spokenLabel:spoken(slot.startISO)});if(options.length===3)break;
      }
      if(options.length===3)break;
    }
    if(!options.length)throw Error('No suitable times');
    await collection.updateOne({...filter(sid),'guided.callback.phase':'loading'},{$set:{'guided.callback.phase':'ready','guided.callback.slots':options,'guided.callback.menuId':crypto.randomBytes(12).toString('hex'),'guided.callback.checkedAt':now}},{maxTimeMS:1500});
  }catch{
    await collection.updateOne({...filter(sid),'guided.callback.phase':'loading'},{$set:{'guided.callback.phase':'preferred_time','guided.callback.calendarNeedsReview':true}},{maxTimeMS:1500});
  }
  return get(sid,collection);
}
export async function selectGuidedCallbackSlot(sid,menuId,digit,{collection=calls(),lookup=lookupVoiceCallSlots,book=bookLiveVoiceCallback,now=new Date()}={}){
  const row=await get(sid,collection);if(!row||row.guided.kind!=='callback'||row.guided.status!=='collecting'||row.guided.callback?.phase!=='ready'||row.guided.step!==3||row.guided.callback.answersReady!==true||row.guided.callback.menuId!==menuId)return row;
  const current={...filter(sid),'guided.status':'collecting','guided.callback.phase':'ready','guided.callback.menuId':menuId};
  if(digit==='5'||!['1','2','3','4'].includes(digit)){
    const attempts=(row.guided.callback.menuAttempts||0)+1;
    await collection.updateOne(current,{$set:{'guided.callback.menuAttempts':attempts,...(digit==='5'||attempts>=2?{'guided.callback.phase':'preferred_time'}:{})}},{maxTimeMS:1500});return get(sid,collection);
  }
  if(digit==='4'){
    await collection.updateOne(current,{$set:{'guided.callback.phase':'loading','guided.callback.afterStartISO':row.guided.callback.slots.at(-1).startISO},$unset:{'guided.callback.lookupUntil':1}},{maxTimeMS:1500});return get(sid,collection);
  }
  const selected=row.guided.callback.slots[Number(digit)-1];if(!selected)return row;
  try{
    const result=await lookup({dateISO:selected.startISO.slice(0,10)},{now,timeoutMs:2500});
    if(!result.slots?.some(slot=>slot.slotId===selected.slotId&&slot.startISO===selected.startISO&&slot.endISO===selected.endISO)){
      await collection.updateOne(current,{$set:{'guided.callback.phase':'loading','guided.callback.slotChanged':true},$unset:{'guided.callback.lookupUntil':1}},{maxTimeMS:1500});return get(sid,collection);
    }
    await collection.updateOne(current,{$set:{'guided.callback.phase':row.testMode===false?'booking':'selected','guided.callback.selected':selected,'guided.callback.recheckedAt':now,...(row.testMode===false?{}:{'guided.status':'complete','guided.closedAt':now,status:'message_processing'})}},{maxTimeMS:1500});
    if(row.testMode===false)return completeGuidedCallbackBooking(sid,{collection,book,now});
  }catch{await collection.updateOne(current,{$set:{'guided.callback.phase':'preferred_time','guided.callback.calendarNeedsReview':true}},{maxTimeMS:1500});}
  return get(sid,collection);
}
export async function readGuidedCallbackTimes(sid,{collection=calls()}={}){
  const row=await get(sid,collection);if(!row||row.guided.kind!=='callback')return null;
  if(['loading','booking'].includes(row.guided.callback?.phase)){
    const attempts=(row.guided.callback.waitAttempts||0)+1;
    await collection.updateOne(filter(sid),{$set:{'guided.callback.waitAttempts':attempts,...(attempts>=10?(row.guided.callback.phase==='booking'?{'guided.status':'complete','guided.closedAt':new Date(),'guided.callback.phase':'review','guided.callback.calendarNeedsReview':true}:{'guided.callback.phase':'preferred_time','guided.callback.calendarNeedsReview':true}):{})}},{maxTimeMS:1500});
  }
  return get(sid,collection);
}

export async function completeGuidedCallbackBooking(sid,{collection=calls(),book=bookLiveVoiceCallback,now=new Date()}={}){
  const row=await get(sid,collection);if(!row||row.testMode!==false||row.guided.callback?.phase!=='booking')return row;
  let result;try{result=await book(row,{calls:collection,now});}catch{result={status:'needs_review'};}
  if(result.status==='waiting_for_contact')return get(sid,collection);
  if(result.status==='booked')await collection.updateOne({...filter(sid),'guided.callback.phase':{$in:['booking','review']}},{$set:{'guided.callback.phase':'selected','guided.callback.booking':result,'guided.status':'complete','guided.closedAt':now,status:'message_processing'}},{maxTimeMS:1500});
  else await collection.updateOne({...filter(sid),'guided.callback.phase':'booking'},{$set:{'guided.callback.phase':result.status==='unavailable'?'loading':'review','guided.callback.booking':result,'guided.callback.calendarNeedsReview':result.status!=='unavailable',...(result.status==='unavailable'?{}:{'guided.status':'complete','guided.closedAt':now,status:'message_processing'})},...(result.status==='unavailable'?{$unset:{'guided.callback.lookupUntil':1}}:{})},{maxTimeMS:1500});
  return get(sid,collection);
}
