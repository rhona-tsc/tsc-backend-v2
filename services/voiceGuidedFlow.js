import twilio from 'twilio';
import {VOICE_MAX_SECONDS, VOICE_WEBHOOK_OVERRIDES} from './voiceEnquiryConnection.js';

export const GUIDED_QUESTIONS = [
  {key:'name',label:'Full name',seconds:35,prompt:'Please tell me your full name.'},
  {key:'phone',label:'Phone number',seconds:40,prompt:"Please tell me your phone number, slowly. If you would like us to use the number you are calling from, say use this number."},
  {key:'email',label:'Email address',seconds:65,prompt:'Please tell me your email address. Then spell it slowly, including the part after the at sign. Say dot, dash or underscore where needed. If you do not want email quotes, you can say no email.'},
  {key:'event_date',label:'Event date',seconds:35,prompt:'Please tell me your event date, including the day, month and year.'},
  {key:'location',label:'Event location',seconds:65,prompt:'Please tell me the venue name and event location, including the county and postcode if you know them.'},
  {key:'preferences',label:'Band preferences',seconds:80,prompt:'Please tell me the music styles you would like, how many band members, and any specific instruments. You can also mention bands you have your eye on and your budget, if you have one.'},
  {key:'extras',label:'Additional requests',seconds:60,prompt:'Is there anything else you would like us to know, such as specific songs or a band member DJ add-on? If there is nothing else, just say no additional requests.'},
];
export const GUIDED_GREETING="Hello, you're through to The Supreme Collective. I'm the AI assistant, and I'll be happy to help you today. Your answers will be recorded and transcribed for follow-up and quality review. I'll ask one question at a time. After each answer, please pause for a moment, then press the hash key to continue. You can hang up at any time; any answers already recorded will be kept for the team.";
export const GUIDED_CONSENT_PROMPT='Finally, may we email you quotes and contact you by phone about this enquiry? Please press 1 for both email and phone, 2 for email only, 3 for phone only, or 4 for neither.';
export function guidedConsent(digit){
  if(!['1','2','3','4'].includes(digit))return null;
  return {emailQuotes:['1','2'].includes(digit),phoneFollowup:['1','3'].includes(digit),method:'keypad',choice:digit};
}
export function guidedClosing(row){
  if(row.guided?.status!=='complete')return "Thank you. The answers recorded so far have been saved for the team to review. This is a pilot test, so no customer emails or band requests will be sent. Thank you for your call today.";
  const consent=row.guided.consent;
  const permission=consent?.emailQuotes&&consent?.phoneFollowup?'You have chosen email quotes and phone follow-up.':consent?.emailQuotes?'You have chosen email quotes only.':consent?.phoneFollowup?'You have chosen phone follow-up only.':'You have chosen not to receive email quotes or phone follow-up.';
  return `Thank you. We have saved your answers and contact preferences. ${permission} This is a pilot test, so the team will review your enquiry; no customer emails or band requests will be sent. Thank you for your call today. We really look forward to helping with your event.`;
}
export function guidedRemaining(row,now=Date.now()){
  return Math.max(0,Math.floor((+new Date(row.startedAt)+VOICE_MAX_SECONDS*1000-now)/1000));
}
export function guidedQuestionXml(row,config,{opening=false,notice='',now=Date.now()}={}){
  const xml=new twilio.twiml.VoiceResponse(),voice={voice:'Polly.Amy',language:'en-GB'};
  if(row.guided?.status!=='collecting'||guidedRemaining(row,now)<45){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
  if(opening)xml.say(voice,GUIDED_GREETING);
  if(notice)xml.say(voice,notice);
  const step=row.guided.step,question=GUIDED_QUESTIONS[step],root=`${config.base}/api/voice-enquiries/twilio/guided`;
  if(question){
    const speechBudget=Math.ceil(`${opening?GUIDED_GREETING:''} ${question.prompt} Please answer after the tone, then pause and press hash.`.split(/\s+/).length/2)+3;
    const answerBudget=guidedRemaining(row,now)-speechBudget-40;
    if(answerBudget<2){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
    xml.say(voice,`${question.prompt} Please answer after the tone, then pause and press hash.`);
    // Disable silence detection: only #, hangup or the bounded recording limit ends an answer.
    xml.record({maxLength:Math.max(2,Math.min(question.seconds,answerBudget)),timeout:0,finishOnKey:'#',playBeep:true,trim:'do-not-trim',transcribe:false,method:'POST',action:`${root}/answer/${step}${VOICE_WEBHOOK_OVERRIDES}`,recordingStatusCallback:`${root}/recording/${step}${VOICE_WEBHOOK_OVERRIDES}`,recordingStatusCallbackMethod:'POST',recordingStatusCallbackEvent:'completed absent'});
  }else if(step===GUIDED_QUESTIONS.length){
    if(guidedRemaining(row,now)<Math.ceil(GUIDED_CONSENT_PROMPT.split(/\s+/).length/2)+55){xml.say(voice,guidedClosing(row));xml.hangup();return xml.toString();}
    const gather=xml.gather({input:'dtmf',numDigits:1,timeout:12,actionOnEmptyResult:true,method:'POST',action:`${root}/consent${VOICE_WEBHOOK_OVERRIDES}`});gather.say(voice,GUIDED_CONSENT_PROMPT);
  }else{xml.say(voice,guidedClosing(row));xml.hangup();}
  return xml.toString();
}
export function publicGuidedReview(row){
  const answers=row.guided?.answers||{};
  return {status:row.guided?.status||'interrupted',currentQuestion:GUIDED_QUESTIONS[row.guided?.step]?.label||'Contact permissions',consent:row.guided?.consent?{emailQuotes:row.guided.consent.emailQuotes===true,phoneFollowup:row.guided.consent.phoneFollowup===true,method:'keypad'}:null,answers:GUIDED_QUESTIONS.filter(q=>answers[q.key]).map(q=>({key:q.key,label:q.label,status:answers[q.key].status,endedWithHash:answers[q.key].endedWithHash===true}))};
}
export function publicGuidedRecording(row){
  const parts=GUIDED_QUESTIONS.filter(q=>row.guided?.answers?.[q.key]?.fileId&&+new Date(row.expiresAt)>Date.now()).map(q=>({key:q.key,label:q.label,durationSeconds:row.guided.answers[q.key].durationSeconds||0}));
  return {available:!!parts.length,status:row.guided?.processingStatus||'processing',durationSeconds:parts.reduce((sum,p)=>sum+p.durationSeconds,0),expiresAt:parts.length?row.expiresAt:null,parts};
}
