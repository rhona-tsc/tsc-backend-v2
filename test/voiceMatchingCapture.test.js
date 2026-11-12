import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceAnswerCapture, parseSpokenBudget } from '../services/voiceAnswerCapture.js';
import { matchVoiceBands, normalizeBandSearch } from '../services/voiceBandMatching.js';
import { createEnquiryToolHandler, ENQUIRY_ASSISTANT_INSTRUCTIONS } from '../services/incomingEnquiryAssistant.js';
import { createVoiceConversationTurns } from '../services/voiceConversationTurns.js';
import { buildEnquiryVoiceSession, voiceOpeningEvent } from '../services/voiceEnquiryConnection.js';

const venue={venueId:'ritz1',name:'The Ritz London',address:'150 Piccadilly, London W1J 9BR',county:'Greater London',postcode:'W1J 9BR',postcodeValidated:true,source:'test public reference'};
const band={_id:'a'.repeat(24),status:'approved',tscName:'Test Funk Band',genre:['Funk'],lineups:[{lineupId:'six',actSize:'6-piece',bandMembers:
  ['Lead Male Vocal','Lead Female Vocal','Electric Guitar','Bass Guitar','Keyboard','Drums'].map(instrument=>({instrument}))}]};

test('ordinary singular singer wording produces the same six-piece match as canonical vocal labels',()=>{
  for(const labels of [['male vocal','female vocal'],['male singer','female singer'],['Male vocals','Female vocals']]) {
    const input={styles:['funk'],preferredSize:'6-piece',mustHaveInstruments:labels};
    assert.deepEqual(normalizeBandSearch(input).unknown,[]);
    const result=matchVoiceBands([band],input);assert.equal(result.totalMatches,1);assert.equal(result.needsClarification,false);
    assert.deepEqual(result.constraints.mustHaveInstruments,['Male vocals','Female vocals']);
    assert.equal(result.availabilityChecked,false);assert.equal(result.pricesQuoted,false);
  }
});

test('two requested singer roles must be fulfilled by separate performers in the same lineup',()=>{
  const changed={...band,lineups:[{...band.lineups[0],bandMembers:[{instrument:'Male/Female Vocals'},...band.lineups[0].bandMembers.slice(2),{instrument:'Guitar'}]}]};
  assert.equal(matchVoiceBands([changed],{styles:['Funk'],preferredSize:'6-piece',mustHaveInstruments:['male singer','female singer']}).bands.length,0);
});

test('spoken and numeric budgets retain pounds, scales and range ceilings; ambiguous or other-currency amounts stay unknown',()=>{
  for(const text of ["Life's three thousand five hundred.",'£3,500','about 3500 pounds','3.5k','three thousand and five hundred'])assert.equal(parseSpokenBudget(text),3500);
  assert.equal(parseSpokenBudget('between £3000 and £3500'),3500);
  assert.equal(parseSpokenBudget('not sure'),0);
  for(const text of ['my child is speaking','$3500','three dollars','minus five hundred','99999999','three or four'])assert.equal(parseSpokenBudget(text),undefined);
});

test('budget capture is tied to the budget question, and protects the supplied amount from a later empty model save',()=>{
  const capture=createVoiceAnswerCapture();assert.deepEqual(capture.acceptUser('six'),{});
  capture.observeAssistant("What's your approximate budget, in pounds?");
  assert.deepEqual(capture.acceptUser("Life's three thousand five hundred."),{maxBudget:3500});
  capture.observeAssistant('When do you hope to book?');assert.deepEqual(capture.acceptUser('in a month'),{});
  assert.equal(capture.mergeInput({maxBudget:0,decisionWindow:'a month'}).maxBudget,3500);
});

test('venue wording saves immediately; one lookup candidate retains full canonical location without claiming confirmation',async()=>{
  const writes=[];
  const handler=createEnquiryToolHandler({saveDraft:async(id,draft)=>writes.push(structuredClone(draft)),lookupVenues:async()=>({venues:[venue]})});
  await handler({callId:'testcall',name:'save_enquiry_draft',arguments:{maxBudget:3500,clientName:'Alex'}});
  await handler({callId:'testcall',name:'lookup_venue',arguments:{query:'The Ritz London'}});
  assert.equal(writes.at(-2).address,'The Ritz London');
  const draft=writes.at(-1);assert.equal(draft.maxBudget,3500);assert.equal(draft.clientName,'Alex');
  assert.equal(draft.address,venue.address);assert.equal(draft.county,'Greater London');assert.equal(draft.postcode,'W1J 9BR');
  assert.equal(draft.venueConfirmation.confirmed,false);assert.equal(draft.venueConfirmation.candidate,true);
  await handler({callId:'testcall',name:'save_enquiry_draft',arguments:{styles:['Funk']}});
  assert.equal(writes.at(-1).address,venue.address);assert.equal(writes.at(-1).maxBudget,3500);
});

test('multiple/failed venue lookups preserve raw wording and never silently select a candidate or retain stale county',async()=>{
  const writes=[];let result={venues:[venue]};
  const handler=createEnquiryToolHandler({saveDraft:async(id,draft)=>writes.push(structuredClone(draft)),lookupVenues:async()=>result});
  await handler({callId:'c',name:'lookup_venue',arguments:{query:'Ritz London'}});
  result={venues:[venue,{...venue,venueId:'second'}]};await handler({callId:'c',name:'lookup_venue',arguments:{query:'Different venue'}});
  assert.equal(writes.at(-1).address,'Different venue');assert.equal(writes.at(-1).county,'');assert.equal(writes.at(-1).venueConfirmation,null);
  result={venues:[]};await handler({callId:'c',name:'lookup_venue',arguments:{query:'Unknown venue'}});
  assert.equal(writes.at(-1).address,'Unknown venue');assert.equal(writes.at(-1).postcode,'');
});

function harness() {
  const sent=[],tools=[],errors=[],writes=[];
  const handler=createEnquiryToolHandler({saveDraft:async(id,draft)=>writes.push(structuredClone(draft)),lookupVenues:async()=>({venues:[venue]}),lookupBands:async input=>matchVoiceBands([band],input)});
  const turns=createVoiceConversationTurns({send:event=>sent.push(event),callId:'c',openingEvent:voiceOpeningEvent,
    handleTool:async tool=>{tools.push(tool);return handler(tool);},onError:error=>errors.push(error)});
  let id=0;
  const emit=async event=>{turns.accept(event);await turns.flush();};
  const user=text=>emit({type:'conversation.item.input_audio_transcription.completed',item_id:`u${++id}`,transcript:text});
  const said=text=>emit({type:'response.output_audio_transcript.done',transcript:text});
  const done=()=>emit({type:'response.done'});
  const tool=(name,input)=>emit({type:'response.function_call_arguments.done',call_id:`t${++id}`,name,arguments:JSON.stringify(input)});
  return {sent,tools,errors,writes,turns,emit,user,said,done,tool,responses:()=>sent.filter(event=>event.type==='response.create')};
}

test('unfinished phrases and empty background transcripts do not trigger repeated questions; a completed venue answer is saved',async()=>{
  const h=harness();h.turns.start();await h.said("What's the venue or town and county?");await h.done();
  await h.user('It is...');assert.equal(h.responses().length,1);await h.user('It is...');assert.equal(h.responses().length,1);
  await h.user('');assert.equal(h.responses().length,1);
  await h.user("It's the Ritz in London.");assert.equal(h.writes.at(-1).address,'the Ritz in London.');
  assert.equal(h.responses().length,2);assert.deepEqual(h.errors,[]);
});

test('full turn pipeline saves budget and venue even when the model skips those draft tools, and later saves cannot erase them',async()=>{
  const h=harness();h.turns.start();await h.said("What's your budget?");await h.done();
  await h.user("Life's three thousand five hundred.");assert.equal(h.writes.at(-1).maxBudget,3500);
  await h.said("What's the venue?");await h.done();await h.user('The Ritz in London');
  await h.tool('lookup_venue',{query:'The Ritz London'});await h.done();
  await h.tool('save_enquiry_draft',{styles:['Funk'],maxBudget:0,address:'',county:'',postcode:''});
  assert.equal(h.writes.at(-1).maxBudget,3500);assert.equal(h.writes.at(-1).address,venue.address);
  assert.equal(h.writes.at(-1).county,venue.county);assert.equal(h.writes.at(-1).postcode,venue.postcode);
});

test('successful search supplies a named-act next step and invented horn-section constraints never reach the catalogue',async()=>{
  const h=harness();h.turns.start();await h.done();await h.user('A six-piece funk band with male and female singers.');
  await h.tool('lookup_bands',{styles:['Funk'],preferredSize:'6-piece',mustHaveInstruments:['male vocal','female vocal']});await h.done();
  assert.match(h.responses().at(-1).response.instructions,/Present these returned acts by name now/);
  assert.match(h.responses().at(-1).response.instructions,/Test Funk Band/);
  const calls=h.tools.length;await h.tool('lookup_bands',{styles:['Funk'],mustHaveInstruments:['Brass section'],brassPreferenceConfirmed:true});
  assert.equal(h.tools.length,calls);assert.match(JSON.parse(h.sent.at(-1).item.output).error,/has not requested/);
});

test('caller declining a horn section does not count as requesting one and speech instructions use clearer instrument examples',()=>{
  const capture=createVoiceAnswerCapture();capture.acceptUser("I don't think I mentioned brass section.");assert.equal(capture.hornMentioned,false);
  capture.acceptUser('I would like a horn section.');assert.equal(capture.hornMentioned,true);
  assert.match(ENQUIRY_ASSISTANT_INSTRUCTIONS,/horn section, such as saxophone and trumpet/);
  assert.match(ENQUIRY_ASSISTANT_INSTRUCTIONS,/Do not introduce this question when they only requested singers/);
});

test('speech completion uses low-eagerness semantic detection while manual responses, noise filtering and no interruption remain',()=>{
  const config=buildEnquiryVoiceSession({model:'test'});
  assert.deepEqual(config.audio.input.turn_detection,{type:'semantic_vad',eagerness:'low',create_response:false,interrupt_response:false});
  assert.equal(config.audio.input.noise_reduction.type,'near_field');assert.equal(config.audio.output.voice,'marin');
});
