import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceContactCheckpoint, extractVoiceContacts } from '../services/voiceContactCheckpoint.js';
import { createVoiceConversationTurns } from '../services/voiceConversationTurns.js';
import { buildEnquiryVoiceSession, voiceOpeningEvent, voiceOpeningEventFor } from '../services/voiceEnquiryConnection.js';

test('caller transcript preserves phone order and email punctuation, including explicit no-dot corrections', () => {
  assert.deepEqual(extractVoiceContacts('My email is rhonadownie@gmail.com, and my number is 07885682367.'), {
    clientEmail:'rhonadownie@gmail.com',clientPhone:'+447885682367',
  });
  assert.equal(extractVoiceContacts("It's rona.downie@gmail.com. There's no dot.").clientEmail,'ronadownie@gmail.com');
  assert.equal(extractVoiceContacts('r h o n a d o w n i e at gmail dot com').clientEmail,'rhonadownie@gmail.com');
  assert.equal(extractVoiceContacts('r, h, o, n, a, d, o, w, n, i, e at gmail dot com').clientEmail,'rhonadownie@gmail.com');
  assert.equal(extractVoiceContacts('zero seven eight eight five six eight two three six seven').clientPhone,'+447885682367');
  assert.equal(extractVoiceContacts('0, 7, 8, 8, 5, 6, 8, 2, 3, 6, 7').clientPhone,'+447885682367');
});

test('two volunteered contacts require two separate delivered read-backs and subsequent caller answers', () => {
  const gate = createVoiceContactCheckpoint();
  gate.acceptUser('rhonadownie@gmail.com, 07885682367');
  assert.throws(()=>gate.assertConfirmed({clientEmail:'rhonadownie@gmail.com'}),/separately confirm/);
  const email = gate.response(); assert.equal(email.field,'clientEmail');
  assert.match(email.wording,/r, h, o, n, a, d, o, w, n, i, e/); assert.doesNotMatch(email.wording,/callback|venue|event/);
  gate.delivered(email); gate.acceptUser('Yes.');
  gate.assertConfirmed({clientEmail:'rhonadownie@gmail.com'});
  assert.throws(()=>gate.assertConfirmed({clientPhone:'07885682367'}),/separately confirm/);
  const phone = gate.response(); assert.equal(phone.field,'clientPhone');
  assert.match(phone.wording,/0, 7, 8, 8, 5, 6, 8, 2, 3, 6, 7/); assert.doesNotMatch(phone.wording,/@|venue|email/);
  gate.delivered(phone); gate.acceptUser("Yes, that's correct. Thank you.");
  assert.equal(gate.response(),null);
  gate.assertConfirmed({clientEmail:'rhonadownie@gmail.com',clientPhone:'07885682367'});
});

test('a yes cannot confirm before the read-back has been delivered, or after it was interrupted', () => {
  const gate = createVoiceContactCheckpoint(); gate.acceptUser('07885682367');
  gate.acceptUser('Yes'); assert.throws(()=>gate.assertConfirmed({clientPhone:'07885682367'}));
  gate.delivered(gate.response()); gate.interrupted(); gate.acceptUser('Yes');
  assert.throws(()=>gate.assertConfirmed({clientPhone:'07885682367'}));
});

test('No refers to the pending contact; corrections never advance to venue questions', () => {
  const gate = createVoiceContactCheckpoint(); gate.acceptUser('rona.downie@gmail.com'); gate.delivered(gate.response());
  gate.acceptUser('No.');
  assert.match(gate.response().wording,/correct just your email/);
  assert.doesNotMatch(gate.response().wording,/venue|event|style/);
  gate.acceptUser("My email is rhonadownie@gmail.com. There's no dot.");
  const plan = gate.response(); assert.match(plan.wording,/r, h, o, n, a/); assert.doesNotMatch(plan.wording,/dot, d/);
  assert.throws(()=>gate.assertConfirmed({clientEmail:'rhonadownie@gmail.com'}));
  gate.delivered(plan); gate.acceptUser('Yes'); gate.assertConfirmed({clientEmail:'rhonadownie@gmail.com'});
});

test('both wrong invalidates both contacts; two failures offer another method without marking anything confirmed', () => {
  const gate = createVoiceContactCheckpoint(); gate.acceptUser('rona.downie@gmail.com 07885682367'); gate.delivered(gate.response());
  gate.acceptUser('No, both of those are wrong.');
  assert.throws(()=>gate.assertConfirmed({clientPhone:'07885682367'}));
  gate.acceptUser('No, still wrong.'); assert.match(gate.response().wording,/callback number instead/);
  gate.acceptUser('Use 07700900123 instead.'); assert.equal(gate.response().field,'clientPhone');
});

test('changed contact invalidates earlier confirmation and the model cannot invent a dot or reorder digits', () => {
  const gate = createVoiceContactCheckpoint(); gate.acceptUser('rhonadownie@gmail.com 07885682367'); gate.delivered(gate.response()); gate.acceptUser('Yes');
  assert.throws(()=>gate.draftInput({clientEmail:'rhona.downie@gmail.com'}),/punctuation/);
  assert.throws(()=>gate.draftInput({clientPhone:'07856823367'}),/digits/);
  gate.acceptUser('Actually use different@gmail.com');
  assert.throws(()=>gate.assertConfirmed({clientEmail:'rhonadownie@gmail.com'}));
  assert.throws(()=>gate.assertConfirmed({clientEmail:'different@gmail.com'}));
});

test('explicit contact refusal is respected without inventing a contact', () => {
  const gate = createVoiceContactCheckpoint(); gate.acceptUser('07885682367'); gate.delivered(gate.response());
  assert.deepEqual(gate.acceptUser("I don't want to share my contact details."),{contactDeclined:true});
  assert.equal(gate.response(),null); assert.throws(()=>gate.assertConfirmed({clientPhone:'07885682367'}));
});

function harness() {
  const sent = [], tools = [], errors = [];
  const turns = createVoiceConversationTurns({send:event=>sent.push(event),callId:'synthetic',openingEvent:voiceOpeningEvent,
    handleTool:async tool=>{tools.push(tool);return {saved:true,testMode:true,messagesSent:false};},onError:error=>errors.push(error)});
  let id = 0;
  const emit = async event => {turns.accept(event);await turns.flush();};
  const user = text => emit({type:'conversation.item.input_audio_transcription.completed',item_id:`u${++id}`,transcript:text});
  const done = () => emit({type:'response.done',response:{status:'completed'}});
  const responses = () => sent.filter(event=>event.type==='response.create');
  return {turns,sent,tools,errors,emit,user,done,responses};
}

test('the opening runs once; response completion and draft saving do not restart the greeting', async () => {
  const h = harness(); h.turns.start(); h.turns.start(); await h.done();
  assert.equal(h.responses().length,1);
  assert.match(h.responses()[0].response.instructions,/Hi, you're through/);
  assert.doesNotMatch(h.responses()[0].response.instructions,/Is that okay|you've reached/);
  await h.user('I want to book a band.');
  assert.equal(h.responses().length,2);
  assert.match(h.responses()[1].response.instructions,/Never greet or introduce yourself again/);
});

test('one contact read-back produces no second speech until a new caller turn, even after silence or duplicate events', async () => {
  const h = harness(); h.turns.start(); await h.done();
  const event={type:'conversation.item.input_audio_transcription.completed',item_id:'email1',transcript:'rhonadownie@gmail.com 07885682367'};
  await h.emit(event); await h.done(); await h.emit(event); await h.emit({type:'input_audio_buffer.speech_stopped'});
  assert.equal(h.responses().length,2); assert.equal(h.tools.length,1);
  assert.equal(h.tools[0].arguments.clientPhone,'+447885682367');
  assert.equal(h.responses().at(-1).response.tool_choice,'none');
  await h.user('Yes'); assert.equal(h.responses().length,3);
  assert.match(h.responses().at(-1).response.instructions,/callback number is 0, 7, 8, 8, 5/);
  await h.done(); assert.equal(h.responses().length,3);
  await h.user('Correct'); assert.equal(h.responses().length,4);
  assert.match(h.responses().at(-1).response.instructions,/"clientPhone":"\+447885682367"/);
  assert.deepEqual(h.errors,[]);
});

test('assistant playback must finish before a queued caller answer is treated as contact confirmation', async () => {
  const h = harness(); h.turns.start(); await h.done(); await h.user('07885682367');
  await h.emit({type:'output_audio_buffer.started'}); await h.done();
  await h.user('Yes'); assert.equal(h.responses().length,2);
  await h.emit({type:'output_audio_buffer.stopped'}); assert.equal(h.responses().length,3);
  assert.match(h.responses().at(-1).response.instructions,/"clientPhone":"\+447885682367"/);
});

test('a question plus silent draft save has no extra tool continuation or introduction', async () => {
  const h=harness();h.turns.start();await h.done();await h.user('My name is Mary.');
  await h.emit({type:'response.output_audio_transcript.done',transcript:'Thanks, Mary. Please share your email address.'});
  await h.emit({type:'response.function_call_arguments.done',call_id:'draft1',name:'save_enquiry_draft',arguments:'{"clientName":"Mary"}'});
  assert.equal(h.responses().length,2); await h.done(); assert.equal(h.responses().length,2);
  assert.equal(h.sent.filter(event=>event.type==='conversation.item.create').length,1);
});

test('multiple tools in one response produce one continuation after response.done, and duplicate calls never rerun', async () => {
  const h=harness();h.turns.start();await h.done();await h.user('My name is Mary.');
  const a={type:'response.function_call_arguments.done',call_id:'d1',name:'save_enquiry_draft',arguments:'{"clientName":"Mary"}'};
  await h.emit(a);await h.emit(a);await h.emit({...a,call_id:'d2',arguments:'{"requirements":"Soul wedding"}'});
  assert.equal(h.responses().length,2);assert.equal(h.tools.length,2);
  await h.done();assert.equal(h.responses().length,3);
});

test('unconfirmed final contact and model-invented contacts are blocked before the board handler', async () => {
  const h=harness();h.turns.start();await h.done();await h.user('07885682367');await h.done();
  await h.emit({type:'response.function_call_arguments.done',call_id:'bad-save',name:'request_callback',arguments:'{"clientPhone":"07885682367","confirmed":true}'});
  assert.equal(h.tools.length,1);
  assert.equal(JSON.parse(h.sent.at(-1).item.output).saved,false);
  await h.emit({type:'response.function_call_arguments.done',call_id:'bad-draft',name:'save_enquiry_draft',arguments:'{"clientPhone":"07856823367"}'});
  assert.equal(h.tools.length,1);assert.match(JSON.parse(h.sent.at(-1).item.output).error,/digits/);
});

test('late transcription order is preserved and failed recognition asks for a repeat without inventing an answer', async () => {
  const h=harness();h.turns.start();await h.done();
  await h.emit({type:'input_audio_buffer.committed',item_id:'first'});await h.emit({type:'input_audio_buffer.committed',item_id:'second'});
  await h.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'second',transcript:'Both wrong'});
  assert.equal(h.responses().length,1);
  await h.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'first',transcript:'No'});
  assert.equal(h.responses().length,2);await h.done();
  await h.emit({type:'conversation.item.input_audio_transcription.failed',item_id:'failed'});
  assert.match(h.responses().at(-1).response.instructions,/Could you repeat/);
});

test('session disables automatic replies; callback menu choice also has one short non-redundant opening', () => {
  assert.equal(buildEnquiryVoiceSession({model:'test'}).audio.input.turn_detection.create_response,false);
  assert.doesNotMatch(voiceOpeningEventFor('human_callback').response.instructions,/Is that okay|you've reached|Hello/);
  assert.match(voiceOpeningEventFor('human_callback').response.instructions,/20-minute/);
});
