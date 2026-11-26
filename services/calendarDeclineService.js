import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { google } from 'googleapis';
import { extractBookingRefFromCalendarEvent } from '../utils/calendarBookingIdentity.js';
import { isExplicitAvailabilityDecline } from './availabilityPriorDeclines.js';
import { bookingCalendarId } from '../utils/sharedBookingCalendar.js';

const clean = value => String(value || '').trim();
const emailKey = value => clean(value).toLowerCase().replace(/@googlemail\.com$/, '@gmail.com');
const phoneKey = value => clean(value).replace(/\D/g, '').replace(/^44/, '0');
export const CALENDAR_DECLINE_DELAY_MS = 10 * 60 * 1000;
export const calendarDeclineButton = value => {
  const match = clean(value).match(/^CAL_(YES|NO|LOC):([a-f\d]{24})$/i);
  return match ? { reply: { YES:'yes', NO:'unavailable', LOC:'no' }[match[1].toUpperCase()], id:match[2].toLowerCase() } : null;
};
export function activeCalendarAssignments(board = {}) {
  board ||= {};
  const seen = new Set();
  return [board.assignedMusicians,board.bookingMusicians,board.bandLineup,board.bookingDetails?.assignedMusicians]
    .flatMap(list => Array.isArray(list) ? list : []).filter(row => {
      const key = clean(row.musicianId || row.email) + ':' + clean(row.roleSlotId || row.role || row.instrument);
      if (seen.has(key)) return false;
      seen.add(key);
      return !row.withdrawnAt && ['confirmed','accepted'].includes(clean(row.status).toLowerCase());
    });
}
const jobKey = (board, assignment) => crypto.createHash('sha256').update(`${board._id}:${assignment.musicianId || emailKey(assignment.email)}:${assignment.roleSlotId || assignment.role}`).digest('hex').slice(0,24);
const oid = value => mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : value;

export function createCalendarDeclineService({ db, calendar, send, withdraw, template, now = () => new Date() }) {
  const jobs=db.collection('calendardeclineconfirmations'), boards=db.collection('bookingboarditems'), availability=db.collection('availabilities');
  async function boardFor(event) {
    const ref=extractBookingRefFromCalendarEvent(event);
    let board=ref ? await boards.findOne({bookingRef:ref}) : null;
    if (!board) board=await boards.findOne({calendarEventId:event.id});
    if (!board) {
      const booking=await db.collection('bookings').findOne({$or:[{calendarEventId:event.id},{'calendarMirrors.eventId':event.id}]});
      if (booking) board=await boards.findOne({$or:[{bookingId:booking._id},{sourceBookingId:booking._id},{bookingRef:booking.bookingId}]});
    }
    // Older TSC Gigs entries can predate stored event IDs and booking refs.
    // Adopt only a unique same-day match with BOTH client name and UK postcode.
    if(!board){
      const day=clean(event.start?.dateTime || event.start?.date).slice(0,10);
      const postcode=text=>clean(text).toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)?.[0].replace(/\s/g,'');
      const eventPostcode=postcode(event.location);
      if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&eventPostcode){
        const candidates=await boards.find({eventDateISO:day}).toArray();
        const matches=candidates.filter(candidate=>{
          const first=clean(candidate.clientFirstNames || candidate.bookerName).split(/\s|&/)[0].toLowerCase();
          return first.length>=3&&!['client','customer'].includes(first)&&clean(event.summary).toLowerCase().includes(first)
            &&postcode(candidate.address || candidate.venue)===eventPostcode;
        });
        if(matches.length===1)board=matches[0];
      }
    }
    if (!board || board.cancellation?.cancelledAt || ['cancelled','canceled'].includes(board.bookingStatus)) return null;
    const day=clean(board.eventDateISO);
    return day && day >= now().toISOString().slice(0,10) ? board : null;
  }
  async function explicitDecline(board,assignment) {
    const rows=await availability.find({bookingId:board.bookingRef,reply:{$in:['no','unavailable']}}).toArray();
    return rows.find(row=>isExplicitAvailabilityDecline(row,{musicianId:String(assignment.musicianId || ''),phone:assignment.phone,dateISO:board.eventDateISO,formattedAddress:board.address || board.venue}));
  }
  async function reconcile(event,calendarId) {
    if (event.status==='cancelled') return;
    const board=await boardFor(event); if(!board)return;
    const all=activeCalendarAssignments(board);
    for(const assignment of all){
      let profile=null;
      if(assignment.musicianId)profile=await db.collection('musicians').findOne({_id:oid(assignment.musicianId)});
      const emails=[assignment.email,profile?.email,...(profile?.mergedProfileEmails || [])].filter(Boolean).map(emailKey);
      const attendee=(event.attendees || []).find(item=>emails.includes(emailKey(item.email)));
      if(!attendee)continue;
      const key=jobKey(board,assignment);
      if(attendee.responseStatus!=='declined')continue;
      const prior=await explicitDecline(board,assignment);
      if(prior){await withdraw({board,assignment,reply:prior.reply,reason:'Existing explicit availability withdrawal reconciled with calendar decline',source:'system_decline_reconciliation'});await jobs.updateOne({_id:key},{$set:{state:'handled',handledAt:now()}},{upsert:true});continue;}
      const priorJob=await jobs.findOne({_id:key});
      if(priorJob?.state==='cancelled'||(priorJob?.state==='handled'&&priorJob.reply==='yes'&&+new Date(event.updated)>+new Date(priorJob.repliedAt))){
        await jobs.updateOne({_id:key,state:priorJob.state},{$set:{state:'pending',firstObservedAt:now(),notBefore:new Date(+now()+CALENDAR_DECLINE_DELAY_MS)},$unset:{reply:'',inboundSid:'',messageSid:'',sentAt:'',repliedAt:''}});
      }
      await jobs.updateOne({_id:key},{$setOnInsert:{state:'pending',firstObservedAt:now(),notBefore:new Date(+now()+CALENDAR_DECLINE_DELAY_MS),boardId:board._id,bookingRef:board.bookingRef,musicianId:assignment.musicianId,roleSlotId:assignment.roleSlotId || '',role:assignment.role || assignment.instrument,calendarId,eventId:event.id,inviteEmail:attendee.email},$addToSet:{observations:{calendarId,eventId:event.id,inviteEmail:attendee.email}}},{upsert:true});
    }
  }
  async function dispatch(job) {
    if(job.state!=='pending' || +new Date(job.notBefore)>+now())return 'waiting';
    const board=await boards.findOne({_id:job.boardId});
    const assignment=activeCalendarAssignments(board).find(row=>String(row.musicianId)===String(job.musicianId)&&(!job.roleSlotId||row.roleSlotId===job.roleSlotId));
    if(!board || board.cancellation?.cancelledAt || board.bookingStatus==='cancelled' || !assignment || board.eventDateISO<now().toISOString().slice(0,10)){await jobs.updateOne({_id:job._id,state:'pending'},{$set:{state:'handled',handledAt:now(),reason:'Allocation is no longer active'}});return 'handled';}
    const prior=await explicitDecline(board,assignment);
    if(prior){await withdraw({board,assignment,reply:prior.reply,reason:'Explicit withdrawal received during calendar grace period',source:'system_decline_reconciliation'});await jobs.updateOne({_id:job._id},{$set:{state:'handled',handledAt:now()}});return 'handled';}
    const observations=job.observations?.length?job.observations:[job];
    let declined=false;
    for(const observation of observations){try{const event=(await calendar.events.get({calendarId:observation.calendarId,eventId:observation.eventId})).data;if(event.status!=='cancelled'&&(event.attendees||[]).some(a=>emailKey(a.email)===emailKey(observation.inviteEmail)&&a.responseStatus==='declined'))declined=true;}catch(error){if(![404,410].includes(Number(error.code)))throw error;}}
    if(!declined){await jobs.updateOne({_id:job._id,state:'pending'},{$set:{state:'cancelled',handledAt:now(),reason:'Calendar decline was retracted'}});return 'cancelled';}
    const profile=assignment.musicianId?await db.collection('musicians').findOne({_id:oid(assignment.musicianId)}):null;
    if(profile?.profileDeletedAt||profile?.privateTestProfile){await jobs.updateOne({_id:job._id},{$set:{state:'handled',reason:'Profile is no longer eligible'}});return 'handled';}
    const phone=clean(profile?.phoneNormalized || profile?.phone || assignment.phone);
    if(!phone || !(Number(assignment.totalFee || assignment.fee)>0)){await jobs.updateOne({_id:job._id},{$set:{lastError:'A saved phone number and musician fee are required'}});return 'blocked';}
    const contentSid=await template();if(!contentSid)return 'template_pending';
    const claimed=await jobs.findOneAndUpdate({_id:job._id,state:'pending'},{$set:{state:'sending',attemptedAt:now(),phone}},{returnDocument:'after'});
    if(!claimed)return 'claimed_elsewhere';
    try{
      // Recheck after external calendar/template calls: a website withdrawal
      // may have arrived while those were in flight.
      const latest=await boards.findOne({_id:job.boardId});
      const stillActive=activeCalendarAssignments(latest).find(row=>String(row.musicianId)===String(job.musicianId)&&(!job.roleSlotId||row.roleSlotId===job.roleSlotId));
      if(!stillActive || await explicitDecline(latest,stillActive)){
        await jobs.updateOne({_id:job._id,state:'sending'},{$set:{state:'handled',reason:'Withdrawal received before confirmation send',handledAt:now()}});return 'handled';
      }
      const date=new Date(board.eventDateISO+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'});
      const act=board.actTscName || board.actName || job.role;
      const role=[assignment.role,...(assignment.duties || [])].filter(Boolean).join(' · ');
      const result=await send({to:phone,contentSid,requireTemplate:true,allowDefaultContentSid:false,allowSmsFallback:false,source:'calendar-decline-confirmation',requestId:'CAL_'+job._id,skipFeeCompute:true,variables:{'1':profile?.firstName||assignment.firstName||'there','2':act,'3':date,'4':board.address||board.venue,'5':String(assignment.totalFee||assignment.fee),'6':role,'7':job._id}});
      const sid=result?.sid || result?.messageSid;if(!sid)throw Error('No provider receipt returned');
      await jobs.updateOne({_id:job._id,state:'sending'},{$set:{state:'sent',sentAt:now(),messageSid:sid}});
      return 'sent';
    }catch(error){await jobs.updateOne({_id:job._id,state:'sending'},{$set:{state:'uncertain',lastError:clean(error.message),failedAt:now()}});throw error;}
  }
  async function respond({payload,from,sid}) {
    const button=calendarDeclineButton(payload);if(!button)return false;
    const job=await jobs.findOne({_id:button.id});
    if(!job || !['sent','responding'].includes(job.state) || !phoneKey(from) || phoneKey(from)!==phoneKey(job.phone))return true;
    if(job.state==='responding')return true;
    const board=await boards.findOne({_id:job.boardId});
    const assignment=activeCalendarAssignments(board).find(row=>String(row.musicianId)===String(job.musicianId)&&(!job.roleSlotId||row.roleSlotId===job.roleSlotId));
    if(!assignment){await jobs.updateOne({_id:job._id},{$set:{state:'handled',reason:'Website withdrawal or allocation change already handled'}});return true;}
    const claim=await jobs.findOneAndUpdate({_id:job._id,state:'sent'},{$set:{state:'responding',reply:button.reply,inboundSid:sid,repliedAt:now()}},{returnDocument:'after'});if(!claim)return true;
    try{
      if(button.reply==='yes'){
        for(const o of job.observations||[job]){const event=(await calendar.events.get({calendarId:o.calendarId,eventId:o.eventId})).data;if(event.status==='cancelled')continue;const attendees=(event.attendees||[]).map(a=>emailKey(a.email)===emailKey(o.inviteEmail)?{...a,responseStatus:'accepted'}:a);await calendar.events.patch({calendarId:o.calendarId,eventId:o.eventId,requestBody:{attendees},sendUpdates:'none'});}
        await availability.updateOne({bookingId:board.bookingRef,musicianId:assignment.musicianId},{$set:{calendarCancellationConfirmationPending:false,calendarStatus:'accepted',calendarDeclinedAt:null}});
      }else await withdraw({board,assignment,reply:button.reply,reason:button.reply==='no'?'Musician confirmed unavailable for this location':'Musician confirmed unavailable after calendar decline',source:'calendar_decline_confirmed'});
      await jobs.updateOne({_id:job._id},{$set:{state:'handled',handledAt:now()}});
      return true;
    }catch(error){await jobs.updateOne({_id:job._id},{$set:{state:'needs_review',lastError:clean(error.message)}});throw error;}
  }
  return {reconcile,dispatch,respond,boardFor};
}

async function runtime() {
  const [{oauth2Client},{sendWhatsAppMessage},{withdrawAllocatedBooking},{default:Board},{default:Twilio}]=await Promise.all([import('../controllers/googleController.js'),import('../utils/twilioClient.js'),import('../controllers/allocationController.js'),import('../models/bookingBoardItem.js'),import('twilio')]);
  const db=mongoose.connection.db,calendar=google.calendar({version:'v3',auth:oauth2Client});
  const template=async()=>{
    const row=await db.collection('calendarsettings').findOne({_id:'calendar-decline-template'});if(!row?.sid)return null;
    if(row.status==='approved')return row.sid;
    if(!row.checkedAt || +new Date(row.checkedAt)<Date.now()-300000){const c=Twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);const approval=await c.content.v1.contents(row.sid).approvalFetch().fetch();const status=approval.whatsapp?.status;await db.collection('calendarsettings').updateOne({_id:row._id},{$set:{status,checkedAt:new Date()}});if(status==='approved')return row.sid;}
    return null;
  };
  const withdraw=async({board,assignment,reply,...details})=>{
    const current=await Board.findById(board._id);const active=activeCalendarAssignments(current).find(a=>String(a.musicianId)===String(assignment.musicianId)&&a.roleSlotId===assignment.roleSlotId);if(!active)return;
    return withdrawAllocatedBooking({board:current,assignment:active,user:{musicianId:assignment.musicianId,email:assignment.email},availabilityReply:reply,...details});
  };
  return {db,calendar,service:createCalendarDeclineService({db,calendar,send:sendWhatsAppMessage,withdraw,template})};
}
export async function handleCalendarDeclineReply(input){return (await runtime()).service.respond(input);}
export async function runCalendarDeclineReconciliation() {
  const {db,calendar,service}=await runtime();const state=db.collection('calendarreconciliationstate'),now=new Date(),lease=crypto.randomUUID();
  try{const lock=await state.findOneAndUpdate({_id:'worker',$or:[{leaseUntil:{$lt:now}},{leaseUntil:{$exists:false}}]},{$set:{lease,leaseUntil:new Date(+now+90000)}},{upsert:true,returnDocument:'after'});if(!lock)return {busy:true};}catch(error){if(error.code===11000)return {busy:true};throw error;}
  const outcomes=[];
  try{
    for(const calendarId of [...new Set(['primary',bookingCalendarId()])]){
      const cursor=await state.findOne({_id:'cursor:'+calendarId});const updatedMin=new Date(cursor?.lastCheckedAt?+new Date(cursor.lastCheckedAt)-600000:+now-86400000).toISOString();let pageToken;
      do{const result=await calendar.events.list({calendarId,updatedMin,timeMin:new Date(now.toISOString().slice(0,10)+'T00:00:00Z').toISOString(),timeMax:new Date(+now+730*86400000).toISOString(),singleEvents:true,showDeleted:false,maxResults:250,pageToken});for(const event of result.data.items||[])await service.reconcile(event,calendarId);pageToken=result.data.nextPageToken;}while(pageToken);
      await state.updateOne({_id:'cursor:'+calendarId},{$set:{lastCheckedAt:now}},{upsert:true});
    }
    const due=await db.collection('calendardeclineconfirmations').find({state:'pending',notBefore:{$lte:new Date()}}).limit(100).toArray();
    for(const job of due){try{outcomes.push({id:job._id,state:await service.dispatch(job)});}catch(error){outcomes.push({id:job._id,state:'needs_review',error:error.message});}}
    return {outcomes};
  }finally{await state.updateOne({_id:'worker',lease},{$unset:{lease:'',leaseUntil:''}});}
}
