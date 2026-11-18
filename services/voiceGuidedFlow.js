import twilio from 'twilio';
import {VOICE_MAX_SECONDS, VOICE_WEBHOOK_OVERRIDES} from './voiceEnquiryConnection.js';

export const GUIDED_QUESTIONS = [
  {key:'name',label:'Full name',seconds:35,prompt:'Please tell me your full name.'},
  {key:'phone',label:'Phone number',seconds:40,prompt:"Would you like someone from the team to follow up about your enquiry by phone? If so, please tell me your phone number slowly, or say use this number. If not, please say no phone calls."},
  {key:'email',label:'Email address',seconds:65,prompt:'Would you like us to send your quotes by email? If so, please tell me your email address, then spell it slowly, including the part after the at sign. Say dot, dash or underscore where needed. If not, please say no email quotes.'},
  {key:'event_date',label:'Event date',seconds:35,prompt:'Please tell me your event date, including the day, month and year.'},
  {key:'location',label:'Event location',seconds:65,prompt:'Please tell me the venue name and event location, including the county and postcode if you know them.'},
  {key:'preferences',label:'Band preferences',seconds:80,prompt:'Please tell me the music styles you would like, how many band members, and any specific instruments. You can also mention bands you have your eye on and your budget, if you have one.'},
  {key:'extras',label:'Additional requests',seconds:60,prompt:'Is there anything else you would like us to know, such as specific songs or a band member DJ add-on? If there is nothing else, just say no additional requests.'},
];

export const GUIDED_CALLBACK_QUESTIONS = [
  GUIDED_QUESTIONS[0],
  {key:'phone',label:'Callback phone number',seconds:40,prompt:'What phone number should someone from the team use for your callback? Please say the number slowly, or say use this number if you want us to use the number you are calling from.'},
  {key:'callback_reason',label:'Reason for the call',seconds:65,prompt:'Please leave a brief note explaining the reason for your call, so someone from the team can prepare before calling you back.'},
  {key:'callback_preference',label:'Preferred callback time',seconds:45,prompt:'Please tell us a preferred day and time for your callback. Human calls are twenty minutes, Monday to Thursday, ten a.m. to four p.m. UK time. The team will confirm a suitable time with you.'},
];
export const GUIDED_RECORDING_KEYS=[...new Set([...GUIDED_QUESTIONS,...GUIDED_CALLBACK_QUESTIONS].map(q=>q.key))];
export const guidedQuestions=row=>row.guided?.kind==='callback'?GUIDED_CALLBACK_QUESTIONS:GUIDED_QUESTIONS;
export const GUIDED_ANSWER_INSTRUCTIONS="I'll ask one question at a time. After each answer, please pause for a moment, then press the hash key to continue. You can hang up at any time; any answers already recorded will be kept for the team.";
const menuIntro="Hello, you're through to The Supreme Collective. I'm the AI assistant, and I'll be happy to help you today. Your answers will be recorded and transcribed for follow-up and quality review.";
export const GUIDED_ROUTE_PROMPT='If you are calling about something other than a new band enquiry, please press 1 to arrange a callback. For a new band enquiry, please stay on the line.';
export function guidedRouteXml(row,config){
  const xml=new twilio.twiml.VoiceResponse();
  xml.say({voice:'Polly.Amy',language:'en-GB'},menuIntro);
  const gather=xml.gather({input:'dtmf',numDigits:1,timeout:5,actionOnEmptyResult:true,method:'POST',action:`${config.base}/api/voice-enquiries/twilio/guided/route${VOICE_WEBHOOK_OVERRIDES}`});
  gather.say({voice:'Polly.Amy',language:'en-GB'},GUIDED_ROUTE_PROMPT);
  return xml.toString();
}
export function callbackTimesXml(row,config){
  const xml=new twilio.twiml.VoiceResponse(),voice={voice:'Polly.Amy',language:'en-GB'},state=row.guided.callback||{},root=`${config.base}/api/voice-enquiries/twilio/guided`;
  if(guidedRemaining(row)<90){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
  if(state.phase==='selected'){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
  if(state.phase==='ready'){
    const gather=xml.gather({input:'dtmf',numDigits:1,timeout:15,actionOnEmptyResult:true,method:'POST',action:`${root}/callback-choice/${state.menuId}${VOICE_WEBHOOK_OVERRIDES}`});
    const choices=(state.slots||[]).map((slot,index)=>`Press ${index+1} for ${slot.spokenLabel||slot.label}.`).join(' ');
    gather.say(voice,`These twenty-minute callback times are currently free in the calendar. All times are UK time. ${choices} Press 4 for later options, or press 5 to leave your preferred time for the team to confirm.`);return xml.toString();
  }
  xml.say(voice,'Please hold for a moment while I check the calendar for suitable callback times.');xml.pause({length:2});xml.redirect({method:'POST'},`${root}/callback-times${VOICE_WEBHOOK_OVERRIDES}`);return xml.toString();
}

export const GUIDED_GREETING="Hello, you're through to The Supreme Collective. I'm the AI assistant, and I'll be happy to help you today. Your answers will be recorded and transcribed for follow-up and quality review. I'll ask one question at a time. After each answer, please pause for a moment, then press the hash key to continue. You can hang up at any time; any answers already recorded will be kept for the team.";
export const GUIDED_CONSENT_PROMPT='Finally, may we email you quotes and contact you by phone about this enquiry? Please press 1 for both email and phone, 2 for email only, 3 for phone only, or 4 for neither.';
export function guidedConsent(digit){
  if(!['1','2','3','4'].includes(digit))return null;
  return {emailQuotes:['1','2'].includes(digit),phoneFollowup:['1','3'].includes(digit),method:'keypad',choice:digit};
}
export function guidedClosing(row){
  if(row.testMode===false){
    if(row.guided?.kind==='callback'){const callback=row.guided.callback;return callback?.booking?.status==='booked'?`Thank you. Your twenty-minute callback is booked for ${callback.selected.spokenLabel||callback.selected.label}, UK time. We have saved your reason for calling. Someone from the team will call you then. Thank you for your call today.`:'Thank you. Your callback details and reason for calling have been saved. Someone from the team will review your request and confirm a suitable time with you. Thank you for your call today.';}
    return 'Thank you. Your answers and follow-up preferences have been saved. The team will review your enquiry and get back to you using the contact preferences you gave. Thank you for your call today. We really look forward to helping with your event.';
  }
  if(row.guided?.kind==='callback')return row.guided.callback?.phase==='selected'?`Thank you. Your callback request for ${row.guided.callback.selected.label} and your reason for calling have been saved for the team. This is a pilot test, so the appointment is a proposal only and has not been booked in the calendar.`:"Thank you. Your callback details and reason for calling have been saved for the team to review. This is a pilot test, so no appointment has been booked in the calendar.";
  if(row.guided?.status!=='complete')return "Thank you. The answers recorded so far have been saved for the team to review. This is a pilot test, so no customer emails or band requests will be sent. Thank you for your call today.";
  if(row.guided.version>=2)return "Thank you. We have saved your answers and follow-up preferences for the team to review. This is a pilot test, so no customer emails or band requests will be sent. Thank you for your call today. We really look forward to helping with your event.";
  const consent=row.guided.consent;
  const permission=consent?.emailQuotes&&consent?.phoneFollowup?'You have chosen email quotes and phone follow-up.':consent?.emailQuotes?'You have chosen email quotes only.':consent?.phoneFollowup?'You have chosen phone follow-up only.':'You have chosen not to receive email quotes or phone follow-up.';
  return `Thank you. We have saved your answers and contact preferences. ${permission} This is a pilot test, so the team will review your enquiry; no customer emails or band requests will be sent. Thank you for your call today. We really look forward to helping with your event.`;
}
export function guidedRemaining(row,now=Date.now()){
  return Math.max(0,Math.floor((+new Date(row.startedAt)+VOICE_MAX_SECONDS*1000-now)/1000));
}
export function guidedQuestionXml(row,config,{opening=false,notice='',now=Date.now()}={}){
  if(row.guided?.version>=3&&row.guided.route==='menu'&&row.guided.status==='collecting')return guidedRouteXml(row,config);
  if(row.guided?.kind==='callback'&&row.guided.step===3&&row.guided.callback?.phase!=='preferred_time'&&row.guided.status==='collecting')return callbackTimesXml(row,config);
  const xml=new twilio.twiml.VoiceResponse(),voice={voice:'Polly.Amy',language:'en-GB'};
  if(row.guided?.status!=='collecting'||guidedRemaining(row,now)<45){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
  if(opening)xml.say(voice,GUIDED_GREETING);
  if(notice)xml.say(voice,notice);
  const step=row.guided.step,question=guidedQuestions(row)[step],root=`${config.base}/api/voice-enquiries/twilio/guided`;
  if(question){
    const speechBudget=Math.ceil(`${opening?GUIDED_GREETING:''} ${question.prompt} Please answer after the tone, then pause and press hash.`.split(/\s+/).length/2)+3;
    const answerBudget=guidedRemaining(row,now)-speechBudget-40;
    if(answerBudget<2){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
    xml.say(voice,`${question.prompt} Please answer after the tone, then pause and press hash.`);
    // Disable silence detection: only #, hangup or the bounded recording limit ends an answer.
    xml.record({maxLength:Math.max(2,Math.min(question.seconds,answerBudget)),timeout:0,finishOnKey:'#',playBeep:true,trim:'do-not-trim',transcribe:false,method:'POST',action:`${root}/answer/${step}${VOICE_WEBHOOK_OVERRIDES}`,recordingStatusCallback:`${root}/recording/${step}${VOICE_WEBHOOK_OVERRIDES}`,recordingStatusCallbackMethod:'POST',recordingStatusCallbackEvent:'completed absent'});
  }else if(step===GUIDED_QUESTIONS.length&&!(row.guided.version>=2)){
    if(guidedRemaining(row,now)<Math.ceil(GUIDED_CONSENT_PROMPT.split(/\s+/).length/2)+55){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
    const gather=xml.gather({input:'dtmf',numDigits:1,timeout:12,actionOnEmptyResult:true,method:'POST',action:`${root}/consent${VOICE_WEBHOOK_OVERRIDES}`});gather.say(voice,GUIDED_CONSENT_PROMPT);
  }else{xml.say(voice,guidedClosing(row));xml.hangup();}
  return xml.toString();
}
export function publicGuidedReview(row){
  const answers=row.guided?.answers||{};
  return {status:row.guided?.status||'interrupted',currentQuestion:guidedQuestions(row)[row.guided?.step]?.label||(row.guided?.version>=2?'Complete':'Contact permissions'),consent:row.guided?.consent?{emailQuotes:typeof row.guided.consent.emailQuotes==='boolean'?row.guided.consent.emailQuotes:null,phoneFollowup:typeof row.guided.consent.phoneFollowup==='boolean'?row.guided.consent.phoneFollowup:null,method:row.guided.consent.method||'keypad'}:null,kind:row.guided?.kind||'enquiry',callback:row.guided?.callback?.selected?{label:row.guided.callback.selected.label,status:'proposed',bookingConfirmed:false}:null,answers:guidedQuestions(row).filter(q=>answers[q.key]).map(q=>({key:q.key,label:q.label,status:answers[q.key].status,endedWithHash:answers[q.key].endedWithHash===true}))};
}
export function publicGuidedRecording(row){
  const parts=guidedQuestions(row).filter(q=>row.guided?.answers?.[q.key]?.fileId&&+new Date(row.expiresAt)>Date.now()).map(q=>({key:q.key,label:q.label,durationSeconds:row.guided.answers[q.key].durationSeconds||0}));
  return {available:!!parts.length,status:row.guided?.processingStatus||'processing',durationSeconds:parts.reduce((sum,p)=>sum+p.durationSeconds,0),expiresAt:parts.length?row.expiresAt:null,parts};
}

export const guidedPermissionLabel=value=>value===true?'yes':value===false?'no':'not confirmed';
