import mongoose from 'mongoose';
import twilio from 'twilio';
import {voiceCallRef,finishVoiceCallReview} from './voiceCallReview.js';
import {GUIDED_QUESTIONS,guidedConsent,guidedRemaining} from './voiceGuidedFlow.js';
import {downloadTwilioRecording,storeVoiceAudio,readVoiceAudio,removeVoiceProviderCopy,transcribeVoicemail,extractVoicemailFields,voicemailDraft} from './voiceVoicemail.js';
import {saveVoiceDraft,lookupVoiceBands} from './voiceEnquiryStore.js';
import {normalizeBandSearch} from './voiceBandMatching.js';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';
const calls=()=>mongoose.connection.db.collection('voice_call_reviews');
const liveFilter=callSid=>({_id:voiceCallRef(callSid),intent:'guided_enquiry',expiresAt:{$gt:new Date()}});
const validSid=sid=>/^CA[a-f\d]{32}$/i.test(sid||'');
const recordingSid=sid=>/^RE[a-f\d]{32}$/i.test(sid||'');
export async function readGuidedIntake(callSid,{collection=calls()}={}){
  if(!validSid(callSid))return null;
  return collection.findOne(liveFilter(callSid),{maxTimeMS:1500});
}
export async function initializeGuidedIntake(callSid,{collection=calls()}={}){
  await collection.updateOne({...liveFilter(callSid),guided:{$exists:false}},{$set:{guided:{version:1,step:0,status:'collecting',answers:{},consentAttempts:0},status:'in_progress'}},{maxTimeMS:1500});
  return readGuidedIntake(callSid,{collection});
}
export async function closeGuidedIntake(callSid,reason='interrupted',{collection=calls()}={}){
  if(!validSid(callSid))return null;
  await collection.updateOne({...liveFilter(callSid),'guided.status':'collecting'},{$set:{'guided.status':reason==='complete'?'complete':'interrupted','guided.closedAt':new Date(),status:'message_processing'}},{maxTimeMS:1500});
  return readGuidedIntake(callSid,{collection});
}
// The signed callback's step is the only association between a recording and a question.
// A recording can never be relabelled or replace a previous answer on a retry.
export async function queueGuidedRecording(callSid,step,body,{collection=calls(),fromAction=false}={}){
  if(!validSid(callSid)||!Number.isInteger(step)||!GUIDED_QUESTIONS[step]||body.CallSid!==callSid)return false;
  if(!fromAction&&!['completed','absent'].includes(body.RecordingStatus))return false;
  const sid=body.RecordingSid,absent=body.RecordingStatus==='absent'||fromAction&&!recordingSid(sid);
  if(!recordingSid(sid)&&!absent)return false;
  const seconds=Number(body.RecordingDuration||0);if(!Number.isFinite(seconds)||seconds<0||seconds>100)return false;
  const row=await readGuidedIntake(callSid,{collection});if(!row||step>row.guided.step)return false;
  const key=GUIDED_QUESTIONS[step].key,existing=row.guided.answers?.[key];
  if(existing?.sid){if(existing.sid!==sid)return false;return true;}
  if(existing?.status==='absent')return absent;
  const answer={...(recordingSid(sid)?{sid}:{}),status:absent?'absent':'queued',durationSeconds:seconds,attempts:0,receivedAt:new Date(),endedWithHash:fromAction&&body.Digits==='#'};
  await collection.updateOne({...liveFilter(callSid),[`guided.answers.${key}.sid`]:{$exists:false},[`guided.answers.${key}.status`]:{$ne:'absent'}},{$set:{[`guided.answers.${key}`]:answer,'guided.processingStatus':'queued'}},{maxTimeMS:1500});
  return true;
}
export async function acceptGuidedAnswer(callSid,step,body,{collection=calls()}={}){
  const row=await readGuidedIntake(callSid,{collection});if(!row||!GUIDED_QUESTIONS[step])return null;
  if(step<row.guided.step)return row; // A retried action renders the current question, never skips one.
  if(step!==row.guided.step||row.guided.status!=='collecting')return row;
  if(!await queueGuidedRecording(callSid,step,body,{collection,fromAction:true}))return row;
  const key=GUIDED_QUESTIONS[step].key;
  await collection.updateOne({...liveFilter(callSid),[`guided.answers.${key}.sid`]:body.RecordingSid},{$set:{[`guided.answers.${key}.endedWithHash`]:body.Digits==='#'}},{maxTimeMS:1500});
  if(body.Digits==='hangup')return closeGuidedIntake(callSid,'interrupted',{collection});
  await collection.updateOne({...liveFilter(callSid),'guided.step':step,'guided.status':'collecting'},{$inc:{'guided.step':1},$set:{'guided.lastAnswerAt':new Date()}},{maxTimeMS:1500});
  return readGuidedIntake(callSid,{collection});
}
export async function acceptGuidedConsent(callSid,digit,{collection=calls()}={}){
  const row=await readGuidedIntake(callSid,{collection});if(!row||row.guided.step!==GUIDED_QUESTIONS.length||row.guided.status!=='collecting')return row;
  const consent=guidedConsent(digit);
  if(!consent){
    await collection.updateOne({...liveFilter(callSid),'guided.status':'collecting'},{$inc:{'guided.consentAttempts':1}},{maxTimeMS:1500});
    return row.guided.consentAttempts>=1?closeGuidedIntake(callSid,'interrupted',{collection}):readGuidedIntake(callSid,{collection});
  }
  await collection.updateOne({...liveFilter(callSid),'guided.step':GUIDED_QUESTIONS.length,'guided.status':'collecting'},{$set:{'guided.consent':{...consent,at:new Date()},'guided.status':'complete','guided.closedAt':new Date(),status:'message_processing'}},{maxTimeMS:1500});
  return readGuidedIntake(callSid,{collection});
}
export function guidedTranscript(row){
  return GUIDED_QUESTIONS.filter(q=>row.guided.answers?.[q.key]).map(q=>`${q.label}: ${row.guided.answers[q.key].transcript||'[Answer not transcribed; listen to its recording]'}`).join('\n');
}
export function guidedTurns(row){
  return GUIDED_QUESTIONS.flatMap((q,index)=>{const a=row.guided.answers?.[q.key];return a?[{itemId:`guided_prompt_${q.key}`,sequence:index*2+1,role:'assistant',text:q.prompt},{itemId:`guided_answer_${q.key}`,sequence:index*2+2,role:'user',text:a.transcript||'',transcriptionPending:!a.transcript&&!['needs_review','absent'].includes(a.status),transcriptionFailed:['needs_review','absent'].includes(a.status)}]:[];});
}
export async function processGuidedAnswer(row,key,{collection=calls(),download=downloadTwilioRecording,storeAudio=storeVoiceAudio,loadAudio=readVoiceAudio,removeCopy=removeVoiceProviderCopy,transcribe=transcribeVoicemail}={}){
  const part=row.guided.answers[key],record={...row,recording:part},prefix=`guided.answers.${key}`;
  try{
    let audio=part.fileId?await loadAudio(part.fileId):await download(record);
    if(!part.fileId){part.fileId=await storeAudio(`${row._id}:${key}`,audio);await collection.updateOne(liveFilter(row.callSid),{$set:{[`${prefix}.fileId`]:part.fileId}});}
    if(await removeCopy(record))await collection.updateOne(liveFilter(row.callSid),{$set:{[`${prefix}.providerCopyRemoved`]:true}});
    const text=part.transcript||await transcribe(audio,{filename:`${key}.mp3`});
    await collection.updateOne(liveFilter(row.callSid),{$set:{[`${prefix}.transcript`]:text,[`${prefix}.status`]:'stored'}});return true;
  }catch{
    await collection.updateOne(liveFilter(row.callSid),{$set:{[`${prefix}.status`]:(part.attempts||0)>=3?'needs_review':'queued'}});return false;
  }
}
// Save literal section answers even if optional model interpretation is unavailable.
// These simple recognizers never infer a date year, a venue or an email from a name.
export function literalGuidedFields(row){
  const text=key=>String(row.guided.answers?.[key]?.transcript||'').trim();
  const name=text('name').replace(/^(?:my (?:full )?name is|this is|it is|it's)\s+/i,'').replace(/[.!]$/,'');
  const phone=text('phone').match(/\+?\d[\d\s()-]{7,22}\d/);const emailText=text('email');
  let email=(emailText.match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i)||[])[0]||'';
  if(!email){
    const spoken=emailText.split(/[.!?](?:\s|$)/)[0].replace(/^(?:my )?email(?: address)?(?: is)?\s+/i,'').replace(/\s+(?:at|dot|dash|hyphen|underscore)\s+/gi,word=>({at:'@',dot:'.',dash:'-',hyphen:'-',underscore:'_'}[word.trim().toLowerCase()])).replace(/\s+/g,'');
    if(/^[a-z0-9._+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(spoken))email=spoken;
  }
  const date=text('event_date');let iso=(date.match(/\b\d{4}-\d{2}-\d{2}\b/)||[])[0]||'';
  if(!iso){const m=date.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(20\d{2})\b/i);if(m){const month=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(m[2].toLowerCase())+1;iso=`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;}}
  const preferences=text('preferences'),budget=preferences.match(/£\s*([\d,]+)|\b([\d,]+)\s*(?:pounds|GBP)\b/i),size=preferences.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]+(?:piece|band members?|musicians?)\b/i);
  const numberWords=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  return {clientName:name,clientPhone:phone?.[0]||'',clientEmail:email,eventDateISO:iso,address:text('location'),styles:[],mustHaveInstruments:[],preferredSize:size?`${Number(size[1])||numberWords.indexOf(size[1].toLowerCase())}-piece`:'',maxBudget:budget?Number((budget[1]||budget[2]).replace(/,/g,'')):0,topic:'client_event',reason:'Guided band enquiry',notes:guidedTranscript(row),bandNames:[]};
}
export async function finalizeGuidedIntake(row,{collection=calls(),extract=extractVoicemailFields,saveDraft=saveVoiceDraft,lookupBands=lookupVoiceBands,finish=finishVoiceCallReview,saveConsent=async(sid,consent)=>EnquiryBoardItem.updateOne({websiteKey:`phone:${sid}`,captureState:'draft'},{$set:{'draftDetails.guidedConsent':consent}})}={}){
  const transcript=guidedTranscript(row),turns=guidedTurns(row);
  try{
    const literal=literalGuidedFields(row);let interpretationUnavailable=false,extracted=literal;
    // The recording and literal answers are useful on their own; model interpretation is optional.
    await saveDraft(row.callSid,voicemailDraft(transcript,literal));
    try{if(transcript)extracted={...literal,...await extract(transcript,{additionalInstructions:'This message is a labelled questionnaire. Name, phone, email, event date and event location must come ONLY from their respective labelled answers. Do not use question text as caller facts. Keep specific song requests, DJ add-ons, modern/classic style nuances and any uncertainty in notes. Contact permissions are stored separately by keypad; do not infer consent from this transcript.'})};}catch{interpretationUnavailable=true;}
    // Keep exact literal contact values when they are recognizable; never use a different section.
    for(const key of ['clientName','clientPhone','clientEmail'])if(literal[key])extracted[key]=literal[key];
    const draft=voicemailDraft(transcript,extracted);
    for(const [key,field] of [['name','clientName'],['phone','clientPhone'],['email','clientEmail'],['event_date','eventDateISO'],['location','address'],['location','postcode']])if(!row.guided.answers?.[key]?.transcript)delete draft[field];
    const phone=row.guided.answers?.phone?.transcript||'';
    if(/\buse (?:this|the same|my calling) number\b/i.test(phone)&&/^\+\d{10,15}$/.test(row.caller||''))draft.clientPhone=row.caller;
    const permission=row.guided.consent;
    if(permission?.emailQuotes&&draft.clientEmail)draft.preferredContactMethod='email';else if(permission?.phoneFollowup&&draft.clientPhone)draft.preferredContactMethod='phone';
    draft.requirements=[guidedTranscript(row),draft.requirements,permission?`Caller follow-up permission by keypad: email quotes ${permission.emailQuotes?'yes':'no'}; phone ${permission.phoneFollowup?'yes':'no'}.`:'Follow-up permission not completed; do not contact until reviewed.'].filter(Boolean).join('; ').slice(0,2000);
    await saveDraft(row.callSid,draft);await saveConsent(row.callSid,permission?{emailQuotes:permission.emailQuotes,phoneFollowup:permission.phoneFollowup,method:'keypad',at:permission.at}:{emailQuotes:false,phoneFollowup:false,method:'not_completed'});
    let suggestions=[];const criteria=normalizeBandSearch(draft);
    if(!interpretationUnavailable&&extracted.topic==='client_event'&&!criteria.unknown.length&&(criteria.styles.length||criteria.mustHaveInstruments.length||draft.preferredSize||draft.preferredBands)){
      for(const query of extracted.bandNames?.length?extracted.bandNames.slice(0,3):['']){const found=await lookupBands({...criteria,query});suggestions.push(...(found.bands||[]));}suggestions=[...new Map(suggestions.map(b=>[b.actId,b])).values()].slice(0,3);
    }
    await collection.updateOne(liveFilter(row.callSid),{$set:{turns,transcriptCount:turns.length,transcriptHasGaps:turns.some(t=>t.transcriptionPending||t.transcriptionFailed),'guided.processingStatus':'ready_for_review','guided.interpretationStatus':interpretationUnavailable?'needs_review':'complete',voicemail:{transcript,status:'ready_for_review',suggestedBands:suggestions,missing:['clientName','clientEmail','clientPhone','eventDateISO','address'].filter(k=>!draft[k]),reviewRequired:true,messagesSent:0,...(interpretationUnavailable?{lastError:'Automatic field interpretation is unavailable. Literal answers and original recordings are saved; review them before following up.'}:{})}}});
    await finish(row.callSid,{status:row.guided.status==='complete'?'guided_answers_saved':'guided_partial_saved'});return true;
  }catch{
    const exhausted=(row.guided.finalizeAttempts||0)>=3;
    await collection.updateOne(liveFilter(row.callSid),{$set:{turns,transcriptCount:turns.length,transcriptHasGaps:true,'guided.processingStatus':exhausted?'needs_review':'queued','guided.lastError':'Automatic processing incomplete; listen to the recorded answers and check the details.'}});
    if(exhausted)await finish(row.callSid,{status:'guided_needs_review'});return false;
  }
}
let worker,busy=false;
export function startGuidedVoiceWorker(){
  if(worker)return;
  const run=async()=>{
    if(busy||mongoose.connection.readyState!==1)return;busy=true;
    try{
      const collection=calls(),now=new Date();
      const row=await collection.findOneAndUpdate({intent:'guided_enquiry',expiresAt:{$gt:now},'guided.processingStatus':{$nin:['ready_for_review','needs_review']},$or:[{'guided.claimUntil':{$exists:false}},{'guided.claimUntil':{$lt:now}}]},{$set:{'guided.claimUntil':new Date(Date.now()+3*60000)}},{returnDocument:'after',includeResultMetadata:false});
      const retained=await collection.findOne({intent:'guided_enquiry',expiresAt:{$gt:now},$or:GUIDED_QUESTIONS.map(q=>({[`guided.answers.${q.key}.fileId`]:{$exists:true},[`guided.answers.${q.key}.providerCopyRemoved`]:{$ne:true}}))});
      if(retained){const q=GUIDED_QUESTIONS.find(q=>retained.guided.answers?.[q.key]?.fileId&&!retained.guided.answers[q.key].providerCopyRemoved);if(q&&await removeVoiceProviderCopy({...retained,recording:retained.guided.answers[q.key]}))await collection.updateOne(liveFilter(retained.callSid),{$set:{[`guided.answers.${q.key}.providerCopyRemoved`]:true}});}
      if(!row)return;
      if(row.guided.status==='collecting'){
        // No call is created: read the existing provider call so a hangup during a prompt is saved too.
        const state=await twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN).calls(row.callSid).fetch();
        if(['completed','busy','failed','no-answer','canceled'].includes(state.status)||guidedRemaining(row)<1)await closeGuidedIntake(row.callSid,'interrupted',{collection});
      }
      // One bounded answer at a time. A durable private copy always precedes provider cleanup.
      const answer=GUIDED_QUESTIONS.find(q=>row.guided.answers?.[q.key]?.sid&&['queued'].includes(row.guided.answers[q.key].status)&&(row.guided.answers[q.key].attempts||0)<3);
      if(answer){await collection.updateOne(liveFilter(row.callSid),{$inc:{[`guided.answers.${answer.key}.attempts`]:1}});row.guided.answers[answer.key].attempts=(row.guided.answers[answer.key].attempts||0)+1;await processGuidedAnswer(row,answer.key,{collection});}
      let current=await readGuidedIntake(row.callSid,{collection});
      // Recover at most one missing callback using the only unassigned completed Record on this call.
      const key=GUIDED_QUESTIONS[current.guided.step]?.key;
      if(current.guided.status!=='collecting'&&key&&!current.guided.answers?.[key]&&+new Date(current.guided.closedAt)<Date.now()-15000){
        const recordings=await twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN).recordings.list({callSid:row.callSid,limit:15});
        const known=new Set(Object.values(current.guided.answers||{}).map(a=>a.sid));const unknown=recordings.filter(r=>r.callSid===row.callSid&&r.status==='completed'&&!known.has(r.sid));
        if(unknown.length===1)await queueGuidedRecording(row.callSid,current.guided.step,{CallSid:row.callSid,RecordingSid:unknown[0].sid,RecordingStatus:'completed',RecordingDuration:unknown[0].duration},{collection});
      }
      current=await readGuidedIntake(row.callSid,{collection});const turns=guidedTurns(current);
      await collection.updateOne(liveFilter(row.callSid),{$set:{turns,transcriptCount:turns.length,transcriptHasGaps:turns.some(t=>t.transcriptionPending||t.transcriptionFailed)}});
      const pending=Object.values(current.guided.answers||{}).some(a=>a.status==='queued');
      if(current.guided.status!=='collecting'&&!pending&&+new Date(current.guided.closedAt)<Date.now()-30000){await collection.updateOne(liveFilter(row.callSid),{$inc:{'guided.finalizeAttempts':1}});current.guided.finalizeAttempts=(current.guided.finalizeAttempts||0)+1;await finalizeGuidedIntake(current,{collection});}
      await collection.updateOne(liveFilter(row.callSid),{$unset:{'guided.claimUntil':1}});
    }catch{/* Private messages and provider errors must not be logged. */}finally{busy=false;}
  };
  worker=setInterval(()=>{void run();},15000);worker.unref?.();void run();
}
