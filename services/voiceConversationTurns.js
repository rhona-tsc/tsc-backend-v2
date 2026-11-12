import { createVoiceContactCheckpoint } from './voiceContactCheckpoint.js';
import { ENQUIRY_ASSISTANT_INSTRUCTIONS, VoiceEnquiryValidationError } from './incomingEnquiryAssistant.js';

const expectsAnswer = text => /\?|\bplease\s+(?:share|tell|give|repeat|spell|confirm|let me know)\b|\byour\s+(?:email|number|name|postcode)\b[^.!?]*\bplease\b/i.test(text);

// One response per caller turn, or one continuation after a complete tool batch.
// Draft checkpoint tools are silent when the assistant has already asked a question.
export function createVoiceConversationTurns({ send, handleTool, callId, openingEvent, instructions = ENQUIRY_ASSISTANT_INSTRUCTIONS, onError = () => {} }) {
  const contact = createVoiceContactCheckpoint(), seenUsers = new Set(), seenTools = new Set();
  const users = new Map(), order = [];
  let queue = Promise.resolve(), active = false, playing = false, speaking = false, started = false, closed = false;
  let needsContinuation = false, askedQuestion = false, plan = null, completedPlan = null;
  const respond = (event, checkpoint = null) => {
    if (closed) return;
    active = true; askedQuestion = false; needsContinuation = false; plan = checkpoint;
    send(event);
  };
  const exact = wording => ({type:'response.create',response:{tool_choice:'none',instructions:
    `Say exactly this in a natural British accent, then stop and wait for a new caller answer. Do not add a greeting or another question: ${wording}`}});
  const drain = async () => {
    if (closed || active || playing || speaking) return;
    if (order.length) {
      const ready = [];
      while (order.length && users.get(order[0])?.complete) {
        const id = order.shift(); ready.push(users.get(id)); users.delete(id);
      }
      if (!ready.length) return;
      const text = ready.filter(item => !item.failed).map(item => item.text).join(' ').trim();
      if (!text) { respond(exact("Sorry, I didn't catch that. Could you repeat it, please?")); return; }
      const captured = contact.acceptUser(text);
      // This is the caller's canonical contact text, not a model-created variant.
      // Checkpoint it before the read-back; it remains an unconfirmed draft.
      if (Object.keys(captured).length) await handleTool({callId,name:'save_enquiry_draft',arguments:captured});
      const checkpoint = contact.response();
      if (checkpoint) respond(checkpoint.event, checkpoint);
      else respond({type:'response.create',response:{instructions:`${instructions}\n${contact.context()}`}});
      return;
    }
    if (needsContinuation) {
      // A completed draft save must not trigger a second speech after a question.
      if (askedQuestion) { needsContinuation = false; return; }
      const checkpoint = contact.response();
      if (checkpoint) respond(checkpoint.event, checkpoint);
      else respond({type:'response.create',response:{instructions:`${instructions}\n${contact.context()}`}});
    }
  };
  const process = async event => {
    if (closed) return;
    if (event.type === 'input_audio_buffer.speech_started') { speaking = true; return; }
    if (event.type === 'input_audio_buffer.speech_stopped') { speaking = false; await drain(); return; }
    if (event.type === 'output_audio_buffer.started') { playing = true; return; }
    if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') {
      playing = false;
      if (event.type.endsWith('cleared')) contact.interrupted();
      else if (completedPlan) contact.delivered(completedPlan);
      completedPlan = null; await drain(); return;
    }
    if (event.type === 'conversation.item.truncated') { contact.interrupted(); return; }
    if (event.type === 'input_audio_buffer.committed') {
      if (!seenUsers.has(event.item_id) && !users.has(event.item_id)) { users.set(event.item_id,{complete:false}); order.push(event.item_id); }
      return;
    }
    if (['conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(event.type)) {
      if (seenUsers.has(event.item_id)) return;
      seenUsers.add(event.item_id);
      if (!users.has(event.item_id)) order.push(event.item_id);
      users.set(event.item_id,{complete:true,text:event.transcript || '',failed:event.type.endsWith('failed')});
      await drain(); return;
    }
    if (event.type === 'response.output_audio_transcript.done') { askedQuestion ||= expectsAnswer(event.transcript || ''); return; }
    if (event.type === 'response.function_call_arguments.done') {
      if (seenTools.has(event.call_id)) return;
      seenTools.add(event.call_id);
      let result;
      try {
        let input = typeof event.arguments === 'string' ? JSON.parse(event.arguments) : event.arguments || {};
        if (['save_enquiry','request_callback'].includes(event.name)) contact.assertConfirmed(input);
        if (['save_enquiry_draft','save_enquiry','request_callback'].includes(event.name)) input = contact.draftInput(input);
        result = await handleTool({callId,name:event.name,arguments:input});
      } catch (error) {
        result = {testMode:true,messagesSent:false,sent:0,
          ...(['save_enquiry_draft','save_enquiry','request_callback'].includes(event.name) ? {saved:false} : {lookupSucceeded:false}),
          error:error instanceof VoiceEnquiryValidationError ? error.message : 'Could not complete this request. Do not claim success. Offer to save a draft for someone from the team.'};
      }
      send({type:'conversation.item.create',item:{type:'function_call_output',call_id:event.call_id,output:JSON.stringify(result)}});
      needsContinuation = true;
      // Wait for response.done: one response may contain several function calls.
      return;
    }
    if (event.type === 'response.done') {
      active = false;
      if (plan) { if (playing) completedPlan = plan; else contact.delivered(plan); plan = null; }
      await drain();
    }
  };
  return {
    start() { if (!started && !closed) { started = true; respond(openingEvent); } },
    accept(event) { queue = queue.then(() => process(event)).catch(error => { closed = true; onError(error); }); },
    async flush() { await queue; },
    async close() { closed = true; await queue; },
  };
}
