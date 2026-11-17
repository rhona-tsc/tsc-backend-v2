import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceSectionFlow,explicitYes,VOICE_EXTRA_NOTES_QUESTION} from '../services/voiceSectionFlow.js';
import {createEnquiryToolHandler} from '../services/incomingEnquiryAssistant.js';
import {matchVoiceBands} from '../services/voiceBandMatching.js';
import {createVoiceSectionConversation} from '../services/voiceSectionConversation.js';
import {voiceOpeningEvent} from '../services/voiceEnquiryConnection.js';
import {saveVoiceSectionProgress} from '../services/voiceEnquiryStore.js';

const venue={venueId:'v1',name:'The Ritz London',address:'150 Piccadilly, London W1J 9BR',county:'Greater London',postcode:'W1J 9BR',postcodeValidated:true,source:'public test reference'};
const band={_id:'a'.repeat(24),tscName:'Dancefloor Magic',status:'approved',genre:['Rock','Funk'],lineups:[
  {lineupId:'six',actSize:'6-piece',bandMembers:['Lead Female Vocal','Guitar','Bass Guitar','Drums','Keyboard','Saxophone'].map(instrument=>({instrument}))},
  {lineupId:'five',actSize:'5-piece',bandMembers:['Lead Female Vocal','Guitar','Bass Guitar','Drums','Keyboard'].map(instrument=>({instrument}))},
]};
const other={...band,_id:'b'.repeat(24),tscName:'Test Rock Band'};
function setup(options={}) {
  const drafts=[],saved=[],previews=[],progress=[],calls=[];
  const handler=createEnquiryToolHandler({enforceBookingFlow:true,now:()=>new Date('2026-11-17T12:00:00Z'),
    saveDraft:async(id,draft)=>drafts.push(structuredClone(draft)),saveBoardRecord:async record=>saved.push(structuredClone(record)),
    lookupBands:async(input,selection)=>matchVoiceBands([band,other],input,selection),lookupVenues:async()=>({venues:[venue]}),
    prepareAvailability:async record=>{previews.push(record);return {status:'prepared',requests:record.selectedBands.map(item=>({bandName:item.name})),sent:0,testMode:true};},...options});
  const flow=createVoiceSectionFlow({callId:'synthetic',callerNumber:'+447700900123',now:()=>new Date('2026-11-17T12:00:00Z'),
    handleTool:async request=>{calls.push(request);return handler(request);},saveProgress:async(id,snapshot)=>progress.push(structuredClone(snapshot))});
  const answer=async(text,patch={})=>{if(flow.question){assert.equal(flow.markSpoken(flow.question.text),true,flow.question.text);flow.delivered();}return flow.accept(text,patch);};
  return {flow,answer,drafts,saved,previews,progress,calls};
}
async function throughLocation(h,{email=false}={}) {
  await h.answer('I want Dancefloor Magic for my wedding on 14 December 2026.',{topic:'client_event',eventType:'wedding',bandNames:['Dancefloor Magic'],eventDateISO:'2026-12-14'});
  assert.equal(h.flow.section,'name');
  await h.answer('Alex',{clientName:'Alex'});assert.equal(h.flow.section,'phone');
  await h.answer('Yes');assert.equal(h.flow.section,'email');
  await h.answer(email?'Yes':'No',{wantsEmail:email});
  if(email){await h.answer('alex@example.invalid',{clientEmail:'alex@example.invalid'});await h.answer('Yes');}
  assert.equal(h.flow.section,'event_date');await h.answer('Yes');
  assert.equal(h.flow.section,'location');await h.answer('The Ritz London',{venueQuery:'The Ritz London'});await h.answer('Yes');
}

test('named-band flow checkpoints early facts, completes ordered sections and only prepares previews after final agreement',async()=>{
  const h=setup();await throughLocation(h);
  assert.equal(h.drafts[0].eventDateISO,'2026-12-14');assert.equal(h.drafts[0].preferredBands,'Dancefloor Magic');
  assert.equal(h.flow.section,'bands');assert.equal(h.flow.question.phase,'size');
  await h.answer('Six-piece with saxophone',{preferredSize:'6-piece',mustHaveInstruments:['Saxophone']});
  assert.equal(h.flow.section,'notes');assert.equal(h.flow.question.text,VOICE_EXTRA_NOTES_QUESTION);
  await h.answer('We may want a band member DJ set.',{notes:'Considering a DJ set from a band member.'});
  assert.equal(h.flow.section,'review');assert.equal(h.previews.length,0);assert.equal(h.saved.length,0);
  await h.answer('Yes');
  assert.equal(h.saved.length,1);assert.equal(h.previews.length,1);assert.equal(h.flow.snapshot.sections.availability,'complete');
  const record=h.saved[0];assert.equal(record.eventDateISO,'2026-12-14');assert.equal(record.address,venue.address);assert.equal(record.county,venue.county);assert.equal(record.postcode,venue.postcode);
  assert.equal(record.clientPhone,'+447700900123');assert.equal(record.clientEmail,'');assert.equal(record.preferredContactMethod,'phone');
  assert.equal(record.selectedBands[0].lineupId,'six');assert.match(record.notes,/DJ set from a band member/);
  assert.match(h.flow.question.text,/test availability requests are prepared/);assert.match(h.flow.question.text,/No bands or customers have been contacted/);
});

test('email selection confirms one complete address and chooses the email follow-up path',async()=>{
  const h=setup();await throughLocation(h,{email:true});await h.answer('5-piece',{preferredSize:'5-piece'});await h.answer('No preference');
  await h.answer('No');assert.match(h.flow.question.text,/follow-up choice is email/);assert.doesNotMatch(h.flow.question.text,/We'll email you/);
  await h.answer('Yes');assert.equal(h.saved[0].clientEmail,'alex@example.invalid');assert.equal(h.saved[0].preferredContactMethod,'email');
});

test('a yes about another subject, or an unspoken/misread phone question, cannot save caller-ID consent',async()=>{
  const h=setup();await h.answer('I want to hire a band',{topic:'client_event'});await h.answer('Alex',{clientName:'Alex'});
  assert.equal(h.flow.markSpoken("Hi Alex, I can't check live availability."),false);h.flow.delivered();
  await h.flow.accept('Yes, did I give you the date?',{eventDateISO:'2026-12-14'});
  assert.equal(h.flow.section,'phone');assert.equal(h.drafts.at(-1).clientPhone,'');
  await h.answer('Yes, so I wanted availability on 14 December 2026.',{eventDateISO:'2026-12-14'});
  assert.equal(h.flow.section,'phone');assert.equal(h.drafts.at(-1).clientPhone,'');
  await h.answer('Yes');assert.equal(h.flow.section,'email');assert.equal(h.drafts.at(-1).clientPhone,'+447700900123');
});

test('Thanks is not a goodbye or contact confirmation while a required section is pending',async()=>{
  const h=setup();await h.answer('Band enquiry',{topic:'client_event'});await h.answer('Alex',{clientName:'Alex'});await h.answer('Thanks');
  assert.equal(h.flow.section,'phone');assert.equal(h.previews.length,0);assert.equal(h.saved.length,0);assert.equal(h.drafts.at(-1).clientPhone,'');
});

test('late answers from a previous spoken question cannot confirm a new section',async()=>{
  const h=setup();await h.answer('Band enquiry',{topic:'client_event'});await h.answer('Alex',{clientName:'Alex'});
  h.flow.markSpoken(h.flow.question.text);h.flow.delivered();await h.flow.accept('Yes',{}, {eligible:false});
  assert.equal(h.flow.section,'phone');assert.equal(h.drafts.at(-1).clientPhone,'');
});

test('unknown required date preserves the draft and prevents both confirmed save and availability preparation',async()=>{
  const h=setup();await h.answer('I want Dancefloor Magic',{topic:'client_event',bandNames:['Dancefloor Magic']});await h.answer('Alex',{clientName:'Alex'});await h.answer('Yes');await h.answer('No',{wantsEmail:false});
  await h.answer('Not decided',{unknown:true});await h.answer('The Ritz London',{venueQuery:'The Ritz London'});await h.answer('Yes');
  await h.answer('6-piece',{preferredSize:'6-piece'});await h.answer('No preference');await h.answer('No');
  assert.equal(h.saved.length,0);assert.equal(h.previews.length,0);assert.equal(h.flow.snapshot.sections.event_date,'needs_followup');assert.match(h.flow.question.text,/unconfirmed test draft/);
});

test('no named band follows genre, size and budget before catalogue choices, and suggestions are not auto-selected',async()=>{
  const h=setup();await h.answer('Wedding 14 December 2026',{topic:'client_event',eventDateISO:'2026-12-14'});await h.answer('Alex',{clientName:'Alex'});await h.answer('Yes');await h.answer('No',{wantsEmail:false});await h.answer('Yes');
  await h.answer('Ritz London',{venueQuery:'Ritz London'});await h.answer('Yes');
  assert.equal(h.flow.question.phase,'names');await h.answer('No');assert.equal(h.flow.question.phase,'style');
  await h.answer('Rock',{styles:['Rock']});assert.equal(h.flow.question.phase,'size');
  await h.answer('six-piece',{preferredSize:'6-piece'});assert.equal(h.flow.question.phase,'instruments');await h.answer('No preference');assert.equal(h.flow.question.phase,'budget');
  await h.answer('2500',{maxBudget:2500});assert.equal(h.flow.question.phase,'choose');assert.match(h.flow.question.text,/Dancefloor Magic/);
  assert.equal(h.saved.length,0);await h.answer('Yes');assert.equal(h.flow.question.phase,'choose');
  await h.answer('Dancefloor Magic',{bandNames:['Dancefloor Magic']});assert.equal(h.flow.section,'notes');
  await h.answer('No');await h.answer('Yes');assert.equal(h.saved[0].maxBudget,2500);assert.equal(h.saved[0].selectedBands.length,1);
});

test('partial call progress identifies missing sections without fabricating a completed enquiry',async()=>{
  const h=setup();await h.answer('Dancefloor Magic on 14 December 2026',{topic:'client_event',bandNames:['Dancefloor Magic'],eventDateISO:'2026-12-14'});await h.answer('Alex',{clientName:'Alex'});await h.flow.flush();
  assert.equal(h.flow.snapshot.sections.name,'complete');assert.equal(h.flow.snapshot.sections.phone,'pending');assert.equal(h.flow.snapshot.sections.event_date,'pending');
  assert.equal(h.drafts.at(-1).preferredBands,'Dancefloor Magic');assert.equal(h.drafts.at(-1).eventDateISO,'2026-12-14');assert.equal(h.previews.length,0);
});

test('musician and callback intentions hand back to the existing specialised flow',async()=>{
  for(const [topic,text] of [['musician_job','I am calling about a job advert'],['musician_joining','I want to join your books'],['human_callback','I want to speak to a human'],['technical_question','What stage size do you need?']]){
    const h=setup();assert.deepEqual(await h.flow.accept(text,{topic}),{handoff:true});assert.equal(h.saved.length,0);assert.equal(h.previews.length,0);
  }
});

test('section progress persistence is bounded, test-labelled and can only update a draft',async()=>{
  let filter,update;await saveVoiceSectionProgress('c',{currentSection:'phone',phase:'confirm',sections:{name:'complete',phone:'arbitrary'},requestsSent:999,testMode:false},{Model:{updateOne:async(f,u)=>{filter=f;update=u;}}});
  assert.equal(filter.captureState,'draft');const p=update.$set['draftDetails.sectionProgress'];assert.equal(p.testMode,true);assert.equal(p.requestsSent,0);assert.equal(p.sections.phone,'pending');
});

test('confirmation accepts an explicit short answer and rejects unrelated yes-prefixed statements',()=>{
  for(const text of ['Yes','Yes, thanks','Correct','Perfect.'])assert.equal(explicitYes(text),true);
  for(const text of ["Yes, didn't I give you the date?",'Thanks','Maybe','Yes but a different venue','Are they available?'])assert.equal(explicitYes(text),false);
});

test('transport silently extracts, reads one server question, and refuses an unsaid phone confirmation',async()=>{
  const sent=[],tools=[];let userId=0,response=0;
  const conversation=createVoiceSectionConversation({send:event=>sent.push(event),handleTool:async tool=>{tools.push(tool);return {saved:true};},callId:'c',callerNumber:'+447700900123',openingEvent:voiceOpeningEvent});
  const emit=async event=>{conversation.accept(event);await conversation.flush();};
  const done=()=>emit({type:'response.done',response:{id:`r${++response}`}});
  const user=async(text,patch)=>{
    await emit({type:'conversation.item.input_audio_transcription.completed',item_id:`u${++userId}`,transcript:text});
    const capture=sent.at(-1);assert.equal(capture.response.tools[0].name,'capture_enquiry_section');
    await emit({type:'response.function_call_arguments.done',call_id:`fc${userId}`,name:'capture_enquiry_section',arguments:JSON.stringify(patch)});await done();
  };
  conversation.start();await done();await user('I want a wedding band on 14 December 2026',{topic:'client_event',eventDateISO:'2026-12-14'});
  assert.match(sent.at(-1).response.instructions,/What's your name/);
  await emit({type:'response.output_audio_transcript.done',transcript:"What's your name, please?"});await done();
  await user('Alex',{clientName:'Alex'});assert.match(sent.at(-1).response.instructions,/Can we use/);
  await emit({type:'response.output_audio_transcript.done',transcript:"Hi Alex, I can't check live availability."});await done();
  await user('Yes',{});assert.equal(conversation.snapshot.currentSection,'phone');assert.ok(tools.every(tool=>tool.name==='save_enquiry_draft'));assert.equal(tools.at(-1).arguments.clientPhone,'');
  await conversation.close();
});


test('plain yes cannot be overridden by invented extractor contact choices',async()=>{
  const h=setup();await h.answer('Wedding band',{topic:'client_event'});await h.answer('Alex',{clientName:'Alex'});
  await h.answer('Yes',{contactChoice:'none',clientPhone:'+447700900999',topic:'human_callback'});
  assert.equal(h.flow.section,'email');assert.equal(h.drafts.at(-1).clientPhone,'+447700900123');
});

test('a corrected date or phone returns to that section for a fresh read-back',async()=>{
  const h=setup();await throughLocation(h);await h.answer('6-piece',{preferredSize:'6-piece'});await h.answer('No preference');await h.answer('No');
  assert.equal(h.flow.section,'review');await h.answer('Actually 15 December 2026',{eventDateISO:'2026-12-15'});
  assert.equal(h.flow.section,'event_date');assert.match(h.flow.question.text,/15 December/);await h.answer('Yes');
  assert.equal(h.flow.section,'review');await h.answer('Use 07700900999 instead',{clientPhone:'+447700900999'});
  assert.equal(h.flow.section,'phone');assert.equal(h.drafts.at(-1).clientPhone,'');assert.equal(h.saved.length,0);
  await h.answer('Yes');assert.equal(h.flow.section,'review');await h.answer('Yes');assert.equal(h.saved[0].clientPhone,'+447700900999');
});

test('changed lineup preferences invalidate the previous selection',async()=>{
  const h=setup();await throughLocation(h);await h.answer('6-piece',{preferredSize:'6-piece'});await h.answer('No preference');await h.answer('No');
  await h.answer('Actually a five-piece',{preferredSize:'5-piece'});
  assert.equal(h.flow.section,'review');assert.match(h.flow.question.text,/5-piece/);assert.equal(h.saved.length,0);
  await h.answer('Yes');assert.equal(h.saved[0].selectedBands[0].lineupId,'five');
});

test('same-size lineups are distinguished by requested saxophone rather than choosing the first',async()=>{
  const duplicate={...band,lineups:[{...band.lineups[0],lineupId:'six-no-sax',bandMembers:band.lineups[0].bandMembers.filter(m=>m.instrument!=='Saxophone').concat({instrument:'Trumpet'})},...band.lineups]};
  const h=setup({lookupBands:async(input,selection)=>matchVoiceBands([duplicate],input,selection)});await throughLocation(h);
  await h.answer('Six-piece with saxophone',{preferredSize:'6-piece',mustHaveInstruments:['saxophone']});await h.answer('No');await h.answer('Yes');
  assert.equal(h.saved[0].selectedBands[0].lineupId,'six');
});


test('an optional DJ extra cannot overwrite the captured wedding event type',async()=>{
  const h=setup();await throughLocation(h);await h.answer('6-piece',{preferredSize:'6-piece'});await h.answer('No preference');
  await h.answer('We might want a DJ set from a band member',{eventType:'DJ set request involving a band member',notes:'Band member DJ set'});
  await h.answer('Yes');assert.match(h.saved[0].notes,/Event: wedding/);assert.match(h.saved[0].notes,/Band member DJ set/);
});

test('a name and ordinary answers cannot trigger a specialist detour from a hallucinated topic label',async()=>{
  for(const topic of ['human_callback','technical_question','musician_joining','musician_job']){
    const h=setup();await h.answer('A soul band for my wedding',{topic:'client_event',styles:['Soul']});
    await h.answer('Rona?',{topic,clientName:'Rhona'});
    assert.equal(h.flow.section,'phone');assert.equal(h.flow.snapshot.sections.name,'complete');assert.equal(h.drafts.at(-1).clientName,'Rona');
    await h.answer('Yes',{topic});assert.equal(h.flow.section,'email');
  }
});

test('modern and classic soul, vague size and Saxofon follow the checklist instead of reporting a false no-match',async()=>{
  const soulBand={...band,genre:['Soul & Motown']};
  const h=setup({lookupBands:async(input,selection)=>matchVoiceBands([soulBand],input,selection)});
  await h.answer('I want a soul band for my wedding',{topic:'client_event',styles:['Soul'],eventType:'wedding'});
  await h.answer('Rona?',{topic:'human_callback'});await h.answer('Yes');await h.answer('No');
  await h.answer('14 December 2028',{eventDateISO:'2028-12-14'});await h.answer('Yes');
  await h.answer('The Ritz London',{venueQuery:'The Ritz London'});await h.answer('Yes');await h.answer('No');
  await h.answer('Some modern soul and some classic soul',{styles:['modern soul','classic soul']});
  assert.equal(h.flow.question.phase,'size');assert.doesNotMatch(h.flow.question.text,/modern soul|classic soul/);
  await h.answer('A larger band',{preferredSize:'larger band'});
  assert.equal(h.flow.question.phase,'size');assert.match(h.flow.question.text,/give a number/);assert.equal(h.calls.filter(c=>c.name==='lookup_bands').length,0);
  await h.answer('six');assert.equal(h.flow.question.phase,'instruments');
  await h.answer('Saxofon',{mustHaveInstruments:['Saxofon']});assert.equal(h.flow.question.phase,'budget');
  await h.answer('Up to 4000',{maxBudget:4000});assert.equal(h.flow.question.phase,'choose');
  await h.answer('Dancefloor Magic',{bandNames:['Dancefloor Magic']});assert.equal(h.flow.section,'notes');
  await h.answer('No');await h.answer('Yes');
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].maxBudget,4000);assert.equal(h.saved[0].selectedBands[0].lineupId,'six');
  assert.deepEqual(h.saved[0].styles,['Soul']);assert.deepEqual(h.saved[0].mustHaveInstruments,['Saxophone']);
  assert.match(h.saved[0].notes,/modern soul and some classic soul/);assert.equal(h.flow.snapshot.missing.length,0);
});

test('an unsupported style is retained for clarification rather than silently broadening the search',async()=>{
  const h=setup();await throughLocation(h);await h.answer('I want 6-piece blues',{styles:['Blues'],preferredSize:'6-piece'});
  assert.equal(h.flow.question.phase,'style');assert.match(h.drafts.at(-1).requirements,/style: Blues/);
  assert.equal(h.calls.filter(c=>c.name==='lookup_bands').length,0);assert.doesNotMatch(h.flow.question.text,/classic soul|modern soul/);
});

test('an explicitly removed saxophone requirement is cleared before finding a five-member lineup',async()=>{
  const h=setup();await throughLocation(h);await h.answer('Six-piece with saxophone',{preferredSize:'6-piece',mustHaveInstruments:['Saxophone']});await h.answer('No');
  await h.answer('Five members, forget the saxophone',{preferredSize:'5-piece',clearInstruments:true});
  assert.equal(h.flow.section,'review');await h.answer('Yes');
  assert.deepEqual(h.saved[0].mustHaveInstruments,[]);assert.equal(h.saved[0].selectedBands[0].lineupId,'five');
});

test('a named catalogue act with uncertain performer counts is kept for team review without an invented lineup',async()=>{
  const h=setup({lookupBands:async input=>({bands:input.preferredSize?[]:[{actId:band._id,name:'Dancefloor Magic',lineups:[{lineupId:'unknown',size:null,sizeNeedsReview:true,instruments:['Saxophone']}]}],needsClarification:false})});
  await throughLocation(h);await h.answer('6-piece with saxophone',{preferredSize:'6-piece',mustHaveInstruments:['Saxophone']});
  assert.match(h.flow.question.text,/in our catalogue/);assert.match(h.flow.question.text,/unconfirmed test draft/);assert.doesNotMatch(h.flow.question.text,/Which lineup/);
  assert.equal(h.saved.length,0);assert.equal(h.previews.length,0);assert.equal(h.drafts.at(-1).preferredBands,'Dancefloor Magic');
});

test('a short UK mobile transcription cannot replace the approved incoming number',async()=>{
  const h=setup();await h.answer('A wedding band',{topic:'client_event'});await h.answer('Rona');
  await h.answer('No');await h.answer('0785682367',{clientPhone:'0785682367'});
  assert.equal(h.flow.section,'phone');assert.equal(h.drafts.at(-1).clientPhone,'');assert.doesNotMatch(h.flow.question.text,/0, 7, 8, 5, 6, 8/);
});

test('band names containing number words can pass the spoken shortlist check without a selection loop',async()=>{
  const oneLove={...band,tscName:'One Love',genre:['Soul']};
  const h=setup({lookupBands:async(input,selection)=>matchVoiceBands([oneLove],input,selection)});
  await h.answer('A wedding band on 14 December 2026',{topic:'client_event',eventDateISO:'2026-12-14'});await h.answer('Rona');await h.answer('Yes');await h.answer('No');await h.answer('Yes');
  await h.answer('Ritz London',{venueQuery:'Ritz London'});await h.answer('Yes');await h.answer('No');await h.answer('Soul',{styles:['Soul']});await h.answer('Six band members.');
  await h.answer('Saxophone',{mustHaveInstruments:['Saxophone']});await h.answer('4000',{maxBudget:4000});assert.equal(h.flow.question.phase,'choose');
  await h.answer('Option one please',{selectedOptions:[1]});assert.equal(h.flow.section,'notes');
});

test('a cut-off final test disclosure cannot unlock enquiry confirmation or request preparation',async()=>{
  const h=setup();await throughLocation(h);await h.answer('Six with saxophone',{preferredSize:'6-piece',mustHaveInstruments:['Saxophone']});await h.answer('No');
  const full=h.flow.question.text;assert.equal(h.flow.markSpoken(full.replace('no messages will be sent.','no messages')),false);h.flow.delivered();
  await h.flow.accept('Yes');assert.equal(h.flow.section,'review');assert.equal(h.saved.length,0);assert.equal(h.previews.length,0);
  await h.answer('Yes');assert.equal(h.saved.length,1);assert.equal(h.previews.length,1);
});

test('invented unknown flags cannot skip supplied venue/date or erase an unsupported style',async()=>{
  const h=setup();await h.answer('Wedding',{topic:'client_event'});await h.answer('Rona');await h.answer('Yes');await h.answer('No');
  await h.answer('14 December 2028',{eventDateISO:'2028-12-14',unknown:true});assert.equal(h.flow.question.phase,'confirm');await h.answer('Yes');
  await h.answer('The Ritz London',{venueQuery:'The Ritz London',unknown:true});assert.equal(h.flow.section,'location');assert.equal(h.flow.question.phase,'confirm');
  await h.answer('Yes');await h.answer('No');await h.answer('Blues',{styles:['Blues'],unknown:true});
  assert.equal(h.flow.question.phase,'style');assert.equal(h.calls.filter(c=>c.name==='lookup_bands').length,0);
});

test('placeholder and unspoken venue/date extraction cannot invent answers to missing checklist sections',async()=>{
  const h=setup();await h.answer('Wedding',{topic:'client_event'});await h.answer('Rona?',{clientName:'Rona',venueQuery:'none',postcode:'none',eventDateISO:'2028-12-14',bandNames:['none']});
  assert.equal(h.drafts.at(-1).address,undefined);assert.equal(h.drafts.at(-1).eventDateISO,undefined);assert.equal(h.drafts.at(-1).preferredBands,'');
  await h.answer('Yes');await h.answer('No');assert.equal(h.flow.section,'event_date');assert.equal(h.flow.question.phase,'collect');
  await h.answer('14 December 2028',{eventDateISO:'2028-12-14'});await h.answer('Yes');assert.equal(h.flow.section,'location');assert.equal(h.flow.question.phase,'collect');
});
