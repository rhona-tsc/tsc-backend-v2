import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallTranscript, managementCallEmail, VOICE_MANAGEMENT_EMAIL } from '../services/voiceCallReview.js';
import { appointmentSlots, lookupVoiceCallSlots } from '../services/voiceAppointments.js';
import { lookupVoiceVenues } from '../services/voiceVenueLookup.js';
import { createEnquiryToolHandler, normalizeVoiceEnquiry } from '../services/incomingEnquiryAssistant.js';

test('transcript preserves item order despite late transcription, deduplicates completions, marks interruption and ignores audio/tool secrets', async () => {
  const writes = [], transcript = createCallTranscript({ persist: async data => writes.push(data) });
  transcript.accept({type:'input_audio_buffer.committed',item_id:'user_1',previous_item_id:null});
  transcript.accept({type:'conversation.item.added',item:{id:'assistant_1',role:'assistant'},previous_item_id:'user_1'});
  transcript.accept({type:'response.output_audio_transcript.done',item_id:'assistant_1',transcript:'Here are three bands.'});
  transcript.accept({type:'conversation.item.input_audio_transcription.completed',item_id:'user_1',transcript:'A six-piece soul band, please.'});
  transcript.accept({type:'conversation.item.input_audio_transcription.completed',item_id:'user_1',transcript:'A six-piece soul band, please.'});
  transcript.accept({type:'conversation.item.truncated',item_id:'assistant_1'});
  transcript.accept({type:'response.output_audio.delta',item_id:'secret_audio',delta:'private-audio'});
  transcript.accept({type:'response.function_call_arguments.done',arguments:'secret-tool-data'});
  const result = await transcript.flush();
  assert.deepEqual(result.turns.map(item=>item.role), ['user','assistant']);
  assert.equal(result.turns[1].interrupted,true);
  assert.doesNotMatch(JSON.stringify(writes),/private-audio|secret-tool-data/);
  assert.equal(result.transcriptHasGaps,false);
});

test('transcription and persistence failures are explicit, bounded and never generate invented turns', async () => {
  const transcript = createCallTranscript({persist:async()=>{throw new Error('storage');}});
  transcript.accept({type:'conversation.item.input_audio_transcription.failed',item_id:'user_1'});
  const result=await transcript.flush(); assert.equal(result.transcriptHasGaps,true); assert.equal(result.turns[0].transcriptionFailed,true);
  const bounded=createCallTranscript({persist:async()=>{}});
  for(let i=0;i<250;i++)bounded.accept({type:'input_audio_buffer.committed',item_id:`user_${i}`});
  assert.equal((await bounded.flush()).transcriptLimited,true);
});

test('20-minute callback proposals respect Mon–Thu 10–4 London, DST, busy/transparent/cancelled and all-day blockers', () => {
  const now = new Date('2027-03-26T09:00:00Z');
  assert.equal(appointmentSlots({dateISO:'2027-03-26'},{now}).length,0); // Friday
  const all = appointmentSlots({dateISO:'2027-03-29'},{now});
  assert.equal(all.length,18); assert.equal(all[0].startISO,'2027-03-29T09:00:00.000Z'); assert.equal(all.at(-1).startISO,'2027-03-29T14:40:00.000Z');
  const events=[{start:{dateTime:all[0].startISO},end:{dateTime:all[0].endISO}},{transparency:'transparent',start:{dateTime:all[1].startISO},end:{dateTime:all[1].endISO}},{status:'cancelled',start:{dateTime:all[2].startISO},end:{dateTime:all[2].endISO}}];
  const slots=appointmentSlots({dateISO:'2027-03-29'},{now,events}); assert.equal(slots.length,17); assert.equal(slots[0].slotId,all[1].slotId);
  assert.equal(appointmentSlots({dateISO:'2027-03-29'},{now,events:[{start:{date:'2027-03-29'},end:{date:'2027-03-30'}}]}).length,0);
  assert.equal(appointmentSlots({dateISO:'2027-03-29'},{now,events:[{start:{date:'2027-03-28'},end:{date:'2027-03-29'}}]}).length,18);
});

test('calendar failure does not become an available time and proposed slots never create calendar events', async () => {
  await assert.rejects(lookupVoiceCallSlots({dateISO:'2027-03-29'},{now:new Date('2027-03-26'),loadEvents:async()=>{throw Error('Google');}}));
  const result=await lookupVoiceCallSlots({dateISO:'2027-03-29'},{now:new Date('2027-03-26'),loadEvents:async()=>[]});
  assert.equal(result.bookingConfirmed,false); assert.equal(result.testMode,true);
});

const postcodeRequest = async url => ({ok:true,json:async()=>({result:{postcode:'SL6 0HX',country:'England',admin_county:null,admin_district:'Buckinghamshire'}})});
test('spoken Hedsor variant resolves to official county and full postcode for read-back, without leaking private venue fields', async () => {
  const result=await lookupVoiceVenues({query:'Hepsture House Berkshire'},{loadVenues:async()=>[],request:postcodeRequest,mapsKey:''});
  assert.equal(result.venues[0].name,'Hedsor House'); assert.equal(result.venues[0].county,'Buckinghamshire'); assert.equal(result.venues[0].postcode,'SL6 0HX');
  assert.equal(result.venues[0].needsCallerConfirmation,true); assert.equal(result.travelPriceConfirmed,false);
  await assert.rejects(lookupVoiceVenues({query:'House',postcode:'SL6'},{loadVenues:async()=>[]}),/full postcode/);
});

test('caller must confirm a same-call venue candidate; unresolved county/address never confirms travel', async () => {
  const writes=[], venue={venueId:'candidate1',name:'Hedsor House',address:'Hedsor House SL6 0HX',county:'Buckinghamshire',postcode:'SL6 0HX',source:'official',postcodeValidated:true};
  const handler=createEnquiryToolHandler({lookupVenues:async()=>({venues:[venue]}),saveBoardRecord:async record=>writes.push(record)});
  const data={clientName:'Mary',clientPhone:'07700900123',eventDateISO:'2027-01-01',address:'wrong address',requirements:'Soul wedding',confirmed:true,venueId:'candidate1',venueConfirmed:true};
  await assert.rejects(handler({callId:'call1',name:'save_enquiry',arguments:data}),/Look up this venue/);
  await handler({callId:'call1',name:'lookup_venue',arguments:{query:'Hedsor'}});
  await handler({callId:'call1',name:'save_enquiry',arguments:data}); assert.equal(writes[0].county,'Buckinghamshire');assert.equal(writes[0].venueConfirmation.confirmed,true);
  await assert.rejects(handler({callId:'call2',name:'save_enquiry',arguments:data}),/Look up this venue/);
});

test('email and WhatsApp require explicit read-back consent and email is not invented for WhatsApp', () => {
  const data={clientName:'Mary',clientPhone:'07700900123',confirmed:true,preferredContactMethod:'email',clientEmail:'mary@example.invalid',contactConfirmed:true};
  assert.throws(()=>normalizeVoiceEnquiry(data,{callbackOnly:true}),/Spell the email/);
  assert.equal(normalizeVoiceEnquiry({...data,emailConfirmed:true},{callbackOnly:true}).clientEmail,'mary@example.invalid');
  const whatsapp=normalizeVoiceEnquiry({...data,preferredContactMethod:'whatsapp',clientEmail:''},{callbackOnly:true});assert.equal(whatsapp.clientEmail,'');assert.equal(whatsapp.preferredContactMethod,'whatsapp');
});

test('management summaries have one fixed recipient and describe previews and appointment proposals truthfully', () => {
  const email=managementCallEmail({_id:'PHONE-123',startedAt:new Date(),status:'completed',turns:[]},{clientName:'Mary',clientEmail:'mary@example.invalid',preferredContactMethod:'whatsapp',availabilityRequestTest:{requests:[{}]},callAppointment:{label:'Monday 10am'}});
  assert.equal(email.to,VOICE_MANAGEMENT_EMAIL); assert.equal(email.to,'hello@thesupremecollective.co.uk'); assert.match(email.subject,/AI test call/);assert.match(email.text,/0 sent/);assert.match(email.text,/not booked/);
});

test('modern event flow cannot skip the decision window or band search; an explicit decline permits a saved follow-up', async () => {
  const writes=[],handler=createEnquiryToolHandler({lookupBands:async()=>({bands:[]}),saveBoardRecord:async record=>writes.push(record)});
  const input={clientName:'Mary',clientPhone:'07700900123',confirmed:true,preferredContactMethod:'whatsapp',contactConfirmed:true,eventDateISO:'2027-01-01',address:'Hedsor House',requirements:'Soul band',styles:['Soul'],preferredSize:'6-piece'};
  await assert.rejects(handler({callId:'call1',name:'save_enquiry',arguments:input}),/when the caller hopes/);
  await assert.rejects(handler({callId:'call1',name:'save_enquiry',arguments:{...input,decisionWindow:'This week'}}),/look up suitable bands/);
  await handler({callId:'call1',name:'save_enquiry',arguments:{...input,decisionWindow:'This week',bandSuggestionsDeclined:true}});assert.equal(writes.length,1);
});

test('appointment proposal requires same-call fresh slot, saved phone and explicit confirmation, then rechecks availability', async () => {
  const slot={slotId:'slot1',startISO:'2027-03-29T09:00:00Z',endISO:'2027-03-29T09:20:00Z',label:'Monday 10am UK time'};let free=true,proposals=0;
  const handler=createEnquiryToolHandler({now:()=>new Date('2027-03-26T09:00:00Z'),lookupCallSlots:async()=>({slots:free?[slot]:[]}),saveBoardRecord:async()=>{},prepareAppointment:async()=>{proposals++;}});
  await handler({callId:'call1',name:'lookup_call_slots',arguments:{dateISO:'2027-03-29'}});
  await assert.rejects(handler({callId:'call1',name:'prepare_call_appointment',arguments:{slotId:'slot1',confirmed:true}}),/callback phone/);
  await handler({callId:'call1',name:'request_callback',arguments:{clientName:'Mary',clientPhone:'07700900123',confirmed:true,callbackReason:'Discuss bands'}});
  free=false;await assert.rejects(handler({callId:'call1',name:'prepare_call_appointment',arguments:{slotId:'slot1',confirmed:true}}),/no longer available/);
  free=true;const result=await handler({callId:'call1',name:'prepare_call_appointment',arguments:{slotId:'slot1',confirmed:true}});assert.equal(proposals,1);assert.equal(result.bookingConfirmed,false);
});
