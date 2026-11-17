import {createVoiceSectionFlow,sectionCaptureEvent} from './voiceSectionFlow.js';
import {createVoiceConversationTurns} from './voiceConversationTurns.js';

export function createVoiceSectionConversation({send,handleTool,callId,callerNumber,openingEvent,instructions,onError=()=>{},saveProgress}){
  const flow=createVoiceSectionFlow({callId,callerNumber,handleTool,saveProgress});
  const legacy=createVoiceConversationTurns({send,handleTool,callId,callerNumber,openingEvent,instructions,onError});
  let queue=Promise.resolve(),started=false,closed=false,handedOff=false,active=false,playing=false,speaking=false;
  let kind='',responseId='',lastDelivered=0,speechQuestion=0,patch={},toolCallId='',currentInput=null,missingTimer=null;
  const users=new Map(),order=[],seen=new Set(),responses=new Set();
  const emitPlan=plan=>{
    active=true;kind='speak';responseId='';patch={};toolCallId='';
    send({type:'response.create',response:{tools:[],tool_choice:'none',instructions:
      `You are The Supreme Collective's British voice reader. Read ONLY the following server-approved words, exactly, in a natural British accent. Do not add greetings, say anything about inability, answer another question, or skip/rephrase any digits, names or words. Stop after these words and wait. The application controls the next section.\nWORDS TO READ:\n${plan.text}`,
      input:[{type:'message',role:'system',content:[{type:'input_text',text:`Read this script verbatim; do not answer it or continue the earlier conversation:\n${plan.text}`}]}]}});
  };
  const scheduleMissing=()=>{
    if(missingTimer||!order.length||active||playing||speaking)return;
    missingTimer=setTimeout(()=>{
      missingTimer=null;
      queue=queue.then(async()=>{
        if(closed||handedOff||active||playing||speaking)return;
        while(order.length&&!users.get(order[0])?.complete){users.get(order.shift()).expired=true;}
        await drain();
      }).catch(onError);
    },3500);missingTimer.unref?.();
  };
  const drain=async()=>{
    if(closed||handedOff||active||playing||speaking)return;
    const ready=[];
    while(order.length&&users.get(order[0])?.complete){const id=order.shift();ready.push(users.get(id));users.delete(id);}
    if(!ready.length){scheduleMissing();return;}
    const text=ready.filter(item=>!item.failed).map(item=>item.text).join(' ').trim();
    if(!text){await drain();return;}
    currentInput={text,eligible:ready.every(item=>item.questionId===(flow.question?.id||0)),original:{type:'conversation.item.input_audio_transcription.completed',item_id:`section_handoff_${seen.size}`,transcript:text}};
    if(/^(?:it is|it's|um|erm|uh|one moment|hold on)[\s.!…]*$/i.test(text))return;
    active=true;kind='extract';responseId='';patch={};toolCallId='';send(sectionCaptureEvent(flow.section,text));
  };
  const process=async event=>{
    if(closed)return;
    if(handedOff){legacy.accept(event);await legacy.flush();return;}
    if(event.type==='response.created'){responseId=event.response?.id||'';return;}
    if(event.type==='input_audio_buffer.speech_started'){speaking=true;speechQuestion=lastDelivered;clearTimeout(missingTimer);missingTimer=null;return;}
    if(event.type==='input_audio_buffer.speech_stopped'){speaking=false;await drain();return;}
    if(event.type==='output_audio_buffer.started'){playing=true;return;}
    if(['output_audio_buffer.stopped','output_audio_buffer.cleared'].includes(event.type)){
      playing=false;if(event.type.endsWith('cleared'))flow.interrupted();else if(kind==='speak'){flow.delivered();lastDelivered=flow.question?.delivered?flow.question.id:lastDelivered;}
      await drain();return;
    }
    if(event.type==='conversation.item.truncated'){flow.interrupted();return;}
    if(event.type==='input_audio_buffer.committed'){
      if(!seen.has(event.item_id)&&!users.has(event.item_id)){users.set(event.item_id,{complete:false,questionId:speechQuestion||lastDelivered});order.push(event.item_id);}return;
    }
    if(['conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(event.type)){
      if(seen.has(event.item_id))return;seen.add(event.item_id);
      const old=users.get(event.item_id);if(!old||old.expired)order.push(event.item_id);
      users.set(event.item_id,{...old,complete:true,questionId:old?.questionId??lastDelivered,text:event.transcript||'',failed:event.type.endsWith('failed')});
      await drain();return;
    }
    if(event.type==='response.output_audio_transcript.done'&&kind==='speak'){flow.markSpoken(event.transcript||'');return;}
    if(event.type==='response.function_call_arguments.done'&&kind==='extract'){
      toolCallId=event.call_id;
      if(event.name==='capture_enquiry_section'){try{const input=JSON.parse(event.arguments);if(input&&typeof input==='object'&&!Array.isArray(input))patch=input;}catch{patch={};}}
      return;
    }
    if(event.type==='response.done'){
      const id=event.response?.id;if(id&&(responses.has(id)||responseId&&id!==responseId))return;if(id)responses.add(id);
      active=false;
      if(kind==='extract'){
        if(toolCallId)send({type:'conversation.item.create',item:{type:'function_call_output',call_id:toolCallId,output:JSON.stringify({captured:true,testMode:true,messagesSent:false})}});
        const plan=await flow.accept(currentInput.text,patch,{eligible:currentInput.eligible});
        if(plan.handoff){handedOff=true;legacy.resume(currentInput.original);await legacy.flush();return;}
        emitPlan(plan);return;
      }
      if(kind==='speak'&&!playing){flow.delivered();if(flow.question?.delivered)lastDelivered=flow.question.id;}
      await drain();
    }
  };
  return {
    start(){if(started||closed)return;started=true;active=true;kind='opening';send(openingEvent);},
    accept(event){queue=queue.then(()=>process(event)).catch(error=>{closed=true;clearTimeout(missingTimer);onError(error);});},
    async flush(){await queue;if(handedOff)await legacy.flush();},
    async close(){closed=true;clearTimeout(missingTimer);await queue;await legacy.close();await flow.flush();},
    get snapshot(){return flow.snapshot;},
  };
}
