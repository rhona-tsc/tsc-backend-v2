import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {google} from 'googleapis';
import {CALL_CALENDAR_ID,lookupVoiceCallSlots} from './voiceAppointments.js';
import {normalizeCallbackPhone} from './incomingEnquiryAssistant.js';
import {voiceCallRef} from './voiceCallReview.js';
const clean=(v,max=300)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
export const voiceCallbackEventId=sid=>`tscvoice${crypto.createHash('sha256').update(sid).digest('hex')}`;
function calendar(){
  const auth=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REDIRECT_URI);auth.setCredentials({refresh_token:process.env.GOOGLE_REFRESH_TOKEN});return google.calendar({version:'v3',auth}).events;
}
function ownEvent(event,row,slot){return event?.id===voiceCallbackEventId(row.callSid)&&event.status!=='cancelled'&&event.extendedProperties?.private?.tscVoiceCall===row._id&&+new Date(event.start?.dateTime)===+new Date(slot.startISO)&&+new Date(event.end?.dateTime)===+new Date(slot.endISO);}
export function liveCallbackContact(row){
  const text=row.guided?.answers?.phone?.transcript||'';
  const all=Object.values(row.guided?.answers||{}).map(answer=>answer.transcript||'').join(' ');
  if(/\b(?:no phone calls|don't call (?:me|us)|do not call (?:me|us))\b/i.test(all))return {};
  if(!text)return {pending:row.guided?.answers?.phone?.status==='queued'};
  if(/\b(?:no phone|don't call|do not call|prefer not|rather not)\b/i.test(text))return {};
  const requested=/\buse (?:this|the same|my calling) number\b/i.test(text),literal=(text.match(/\+?\d[\d\s()-]{7,22}\d/)||[])[0];
  const phone=normalizeCallbackPhone(requested?row.caller:literal);return phone?{phone}:{};
}
export async function bookLiveVoiceCallback(row,{events=calendar(),lookup=lookupVoiceCallSlots,claims=mongoose.connection.db.collection('voice_callback_slot_claims'),calls=mongoose.connection.db.collection('voice_call_reviews'),liveEnabled=process.env.VOICE_ENQUIRY_LIVE_ENABLED==='true',now=new Date()}={}){
  if(!liveEnabled||row?.testMode!==false||row.guided?.kind!=='callback'||!/^CA[a-f\d]{32}$/i.test(row.callSid||'')||row._id!==voiceCallRef(row.callSid))throw Error('Live callback booking is not enabled');
  const slot=row.guided.callback?.selected;
  if(!slot||!/^[a-f\d]{24}$/i.test(slot.slotId||'')||+new Date(slot.endISO)-+new Date(slot.startISO)!==20*60000)throw Error('Invalid callback slot');
  const eventId=voiceCallbackEventId(row.callSid);
  try{const existing=(await events.get({calendarId:CALL_CALENDAR_ID,eventId},{timeout:2500})).data;if(!ownEvent(existing,row,slot))return {status:'needs_review'};return {status:'booked',eventId,reused:true};}catch(error){if(error.code!==404&&error.response?.status!==404)throw error;}
  const contact=liveCallbackContact(row);if(contact.pending)return {status:'waiting_for_contact'};if(!contact.phone)return {status:'needs_review'};
  // Never blindly repeat a calendar insert whose outcome may be unknown.
  if(row.guided.callback.bookingAttempted)return {status:'needs_review'};
  await claims.createIndex?.({expiresAt:1},{expireAfterSeconds:0});
  const hold=await claims.findOneAndUpdate({_id:slot.slotId},{$setOnInsert:{callRef:row._id,startISO:slot.startISO,expiresAt:new Date(+new Date(slot.endISO)+86400000)}},{upsert:true,returnDocument:'after',includeResultMetadata:false,maxTimeMS:1500});
  if(hold?.callRef!==row._id)return {status:'unavailable'};
  const fresh=await lookup({dateISO:slot.startISO.slice(0,10)},{now,timeoutMs:2500});
  if(!fresh.slots?.some(s=>s.slotId===slot.slotId&&s.startISO===slot.startISO&&s.endISO===slot.endISO))return {status:'unavailable'};
  await calls.updateOne({_id:row._id},{$set:{'guided.callback.bookingAttempted':true}},{maxTimeMS:1500});
  const name=clean(row.guided.answers?.name?.transcript,100),phone=contact.phone,reason=clean(row.guided.answers?.callback_reason?.transcript,700);
  const description=['Callback requested through The Supreme Collective phone assistant.',`Call reference: ${row._id}`,name&&`Caller name (unverified): ${name}`,phone&&`Preferred phone answer (unverified): ${phone}`,reason&&`Reason: ${reason}`,'Review the saved contact details and original recording before calling:',`https://admin.thesupremecollective.co.uk/enquiry-board?callReview=${row._id}`].filter(Boolean).join('\n');
  try{
    const event=(await events.insert({calendarId:CALL_CALENDAR_ID,sendUpdates:'none',requestBody:{id:eventId,summary:name?`TSC callback — ${name}`:'TSC callback — details in enquiry board',description,visibility:'private',transparency:'opaque',start:{dateTime:slot.startISO,timeZone:'Europe/London'},end:{dateTime:slot.endISO,timeZone:'Europe/London'},extendedProperties:{private:{tscVoiceCall:row._id,source:'tsc_phone_assistant'}},reminders:{useDefault:true}}},{timeout:3000})).data;
    if(!ownEvent(event,row,slot))return {status:'needs_review'};
    return {status:'booked',eventId,reused:false};
  }catch(error){
    try{const event=(await events.get({calendarId:CALL_CALENDAR_ID,eventId},{timeout:2500})).data;if(ownEvent(event,row,slot))return {status:'booked',eventId,reused:true};}catch{}
    return {status:'needs_review'};
  }
}
