import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceContactCheckpoint,contactReadback} from '../services/voiceContactCheckpoint.js';
import {createVoiceConversationTurns} from '../services/voiceConversationTurns.js';
import {voiceOpeningEvent} from '../services/voiceEnquiryConnection.js';

const callerNumber='+447700900123';
function named(caller=callerNumber) {
  const gate=createVoiceContactCheckpoint({callerNumber:caller});
  gate.observeAssistant("What's your name?");assert.deepEqual(gate.acceptUser('Alex'),{clientName:'Alex'});return gate;
}

test('incoming number is only proposed after the name and is never a saved/confirmed contact before permission',()=>{
  const gate=createVoiceContactCheckpoint({callerNumber});assert.equal(gate.response(),null);
  gate.observeAssistant("What's your name?");const captured=gate.acceptUser('Alex');
  assert.equal(captured.clientPhone,undefined);
  const plan=gate.response();assert.match(plan.wording,/You're calling from 0, 7, 7, 0, 0, 9, 0, 0, 1, 2, 3/);
  assert.match(plan.wording,/Can we use this as your callback number/);
  assert.throws(()=>gate.draftInput({clientPhone:callerNumber}),/only a proposal/);
  assert.throws(()=>gate.assertConfirmed({clientPhone:callerNumber}));
});

test('explicit permission after the read-back saves the incoming number and phone preference once, without requiring email',()=>{
  const gate=named();gate.delivered(gate.response());
  assert.deepEqual(gate.acceptUser('Yes, you can use that number.'),{clientPhone:callerNumber,preferredContactMethod:'phone'});
  assert.equal(gate.response(),null);gate.assertConfirmed({clientPhone:callerNumber});
  assert.deepEqual(gate.draftInput({}),{clientPhone:callerNumber,preferredContactMethod:'phone'});
  assert.match(gate.context(),/email is optional/);assert.match(gate.context(),/never verified identity/);
});

test('a yes before the proposed number is read back cannot establish permission',()=>{
  const gate=named();gate.response();assert.equal(gate.acceptUser('Yes').clientPhone,undefined);
  assert.throws(()=>gate.assertConfirmed({clientPhone:callerNumber}));assert.match(gate.response().wording,/Can we use this/);
});

test('declining the detected number asks for a different callback number and never saves the rejected caller ID',()=>{
  const gate=named();gate.delivered(gate.response());assert.deepEqual(gate.acceptUser('No, that is my work number.'),{});
  assert.equal(gate.response().wording,"What's your callback number?");
  assert.throws(()=>gate.assertConfirmed({clientPhone:callerNumber}));
  gate.acceptUser('07700900456');const plan=gate.response();assert.match(plan.wording,/4, 5, 6/);gate.delivered(plan);gate.acceptUser('Yes');
  gate.assertConfirmed({clientPhone:'+447700900456'});assert.throws(()=>gate.assertConfirmed({clientPhone:callerNumber}));
});

test('a different number volunteered with rejection gets its own confirmation rather than inheriting caller-ID consent',()=>{
  const gate=named();gate.delivered(gate.response());gate.acceptUser('No, use 07700900456 instead.');
  assert.throws(()=>gate.assertConfirmed({clientPhone:'07700900456'}));
  gate.delivered(gate.response());gate.acceptUser('Correct');gate.assertConfirmed({clientPhone:'07700900456'});
});

test('caller can choose email or decline all contact rather than accepting the incoming number',()=>{
  const direct=named();direct.delivered(direct.response());direct.acceptUser('Use alex@example.invalid instead.');
  assert.equal(direct.response().field,'clientEmail');direct.delivered(direct.response());direct.acceptUser('Yes');
  assert.equal(direct.response(),null);assert.throws(()=>direct.assertConfirmed({clientPhone:callerNumber}));
  const gate=named();gate.delivered(gate.response());gate.acceptUser('No');gate.delivered(gate.response());gate.acceptUser('I prefer to use email.');
  assert.equal(gate.response().wording,"What's your email address?");
  gate.acceptUser('alex@example.invalid');gate.delivered(gate.response());gate.acceptUser('Yes');gate.assertConfirmed({clientEmail:'alex@example.invalid'});
  assert.throws(()=>gate.assertConfirmed({clientPhone:callerNumber}));
  const declined=named();declined.delivered(declined.response());assert.equal(declined.acceptUser("I don't want to share my contact details.").contactDeclined,true);
  assert.equal(declined.response(),null);
});

test('withheld/invalid caller IDs are not proposed; an email already volunteered is respected',()=>{
  for(const value of ['','anonymous','withheld','unknown','+'])assert.equal(named(value).response(),null);
  const gate=createVoiceContactCheckpoint({callerNumber});gate.acceptUser('alex@example.invalid');
  assert.equal(gate.response().field,'clientEmail');
});

test('email correction read-backs distinguish D and G without adding phonetic words to the saved spelling',()=>{
  assert.match(contactReadback('clientEmail','adg@example.invalid',{clarifyLetters:true}),/D as in Delta, G as in Golf/);
  const gate=createVoiceContactCheckpoint();gate.acceptUser('ag@example.invalid');gate.delivered(gate.response());
  gate.acceptUser('No, ad@example.invalid');assert.match(gate.response().wording,/D as in Delta/);
  assert.equal(gate.draftInput({clientEmail:'ad@example.invalid'}).clientEmail,'ad@example.invalid');
});

function harness() {
  const sent=[],tools=[],errors=[];let id=0;
  const turns=createVoiceConversationTurns({send:event=>sent.push(event),callId:'synthetic',callerNumber,openingEvent:voiceOpeningEvent,
    handleTool:async tool=>{tools.push(tool);return tool.name==='lookup_bands'?{bands:[{name:'Test Rock Band',lineups:[{size:3}]}]}:{saved:true,draft:true,messagesSent:false};},onError:error=>errors.push(error)});
  const emit=async event=>{turns.accept(event);await turns.flush();};
  return {turns,sent,tools,errors,emit,user:text=>emit({type:'conversation.item.input_audio_transcription.completed',item_id:`u${++id}`,transcript:text}),
    done:id=>emit({type:'response.done',...(id?{response:{id}}:{})}),responses:()=>sent.filter(event=>event.type==='response.create')};
}

test('call pipeline saves only the name before consent, then the approved phone without caller having to dictate it',async()=>{
  const h=harness();h.turns.start();await h.emit({type:'response.output_audio_transcript.done',transcript:"What's your name?"});await h.done();
  await h.user('Alex');assert.equal(h.tools.length,1);assert.deepEqual(h.tools[0].arguments,{clientName:'Alex'});
  assert.match(h.responses().at(-1).response.instructions,/Can we use this as your callback number/);
  await h.done();await h.user('Yes');assert.equal(h.tools.at(-1).arguments.clientPhone,callerNumber);
  assert.equal(h.tools.at(-1).arguments.preferredContactMethod,'phone');assert.match(h.responses().at(-1).response.instructions,/"clientPhone":"\+447700900123"/);
  assert.deepEqual(h.errors,[]);
});

test('empty background completion before or after tool response completion cannot swallow the catalogue continuation',async()=>{
  for(const emptyFirst of [true,false]) {
    const h=harness();h.turns.start();await h.done();await h.user('Find rock bands');
    await h.emit({type:'input_audio_buffer.committed',item_id:'empty'});
    await h.emit({type:'response.function_call_arguments.done',call_id:'lookup',name:'lookup_bands',arguments:'{"styles":["Rock"]}'});
    const empty={type:'conversation.item.input_audio_transcription.completed',item_id:'empty',transcript:''};
    if(emptyFirst)await h.emit(empty);await h.done();if(!emptyFirst)await h.emit(empty);
    assert.equal(h.responses().length,3);assert.match(h.responses().at(-1).response.instructions,/Test Rock Band/);
    assert.deepEqual(h.errors,[]);
  }
});

test('duplicate/late response.done cannot open another reply while a newer response is still active',async()=>{
  const h=harness();h.turns.start();await h.emit({type:'response.created',response:{id:'r1'}});await h.done('r1');
  await h.user('Find rock bands');await h.emit({type:'response.created',response:{id:'r2'}});
  await h.done('r1');await h.user('Hello?');assert.equal(h.responses().length,2);
  await h.done('r2');assert.equal(h.responses().length,3);
});
