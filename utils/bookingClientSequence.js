import {finalDetailsDueISO} from './finalDetailsDueDate.js';
import {automation37SendISO} from './automation37Schedule.js';
import {isWeddingBooking} from './referralDiscountCode.js';
export const hasSeparateDetailsReminders = row => row?.importMetadata?.separateEventDetailsReminders === true;
export const referralSendISO = row => {
  if(!row?.importMetadata?.referralEmailEnabled || !isWeddingBooking(row) || !row.referralDiscountCode || row.bookingStatus==='cancelled') return '';
  const d=new Date(`${row.eventDateISO}T12:00:00Z`);if(Number.isNaN(d.getTime()))return '';d.setUTCDate(d.getUTCDate()+30);return d.toISOString().slice(0,10);
};
export function separateDetailsEmail(row,number){
  const date=finalDetailsDueISO(row);const formatted=new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const today=Number(number)===38;return {subject:`Event sheet and playlists due ${today?'today':'soon'}`,text:[`Hi ${row.clientFirstNames||'there'},`,'',`Your completed event sheet and playlists are due ${today?'today':`on ${formatted}`}. Please check the running order, venue access, contacts and any outstanding details, and add your Spotify playlists and advance band-member DJ requests.`,...(row.importMetadata?.afternoonPerformanceReminder?[row.importMetadata.afternoonPerformanceReminder]:[]),'',`Open your event sheet: https://thesupremecollective.co.uk/event-sheet/${encodeURIComponent(row.bookingRef)}`,'','If you have already completed these details, thank you. Please keep the sheet updated if anything changes.','Payment has a separate deadline shown on your invoice; this reminder does not change that date.','','Any questions, please reply to this email.','','Warmest wishes,','Rhona ✨'].join('\n')};
}
export function referralEmail(row,rule,actName){
  if(!referralSendISO(row))throw Error('Referral email prerequisites missing');
  const values={'{{client_names}}':row.clientFirstNames||row.bookerName,'{{act_name}}':actName,'{pulse.text__1}':row.referralDiscountCode};
  const render=s=>Object.entries(values).reduce((v,[k,r])=>v.split(k).join(r),String(s||''));const email={subject:render(rule?.subject),text:render(rule?.body)};
  if(!email.subject||!email.text||/\{(?:\{|pulse\.)/.test(email.subject+email.text))throw Error('Referral email template incomplete');
  email.text+='\n\nWarmest wishes,\nRhona ✨\nThe Supreme Collective\nhttps://thesupremecollective.co.uk';return email;
}
