import crypto from 'node:crypto';
import {extractBookingRefFromCalendarEvent} from './calendarBookingIdentity.js';
import {bookingCalendarAttendees} from './bookingCalendarMirrors.js';

const clean = value => String(value || '').trim();
const normal = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export const bookingCalendarId = () => clean(process.env.BOOKING_CALENDAR_ID) || 'c_0kbngahob779qdifdav366hqtc@group.calendar.google.com';
export const stableBookingEventId = booking => 'tsc'+crypto.createHash('sha256')
  .update(clean(booking._id || booking.bookingRef || booking.bookingId)).digest('hex').slice(0,48);
const missing = error => [404,410].includes(Number(error?.code || error?.status));
const review = message => Object.assign(new Error(message),{code:'BOOKING_CALENDAR_REVIEW_REQUIRED'});

// All confirmed-booking paths use the same identity. A saved legacy invite is
// reused, and concurrent/new retries share one Google event ID per booking.
export async function upsertSharedBookingCalendar({cal,booking,ref,payload,assignments=[]}) {
  if (!clean(ref)) throw review('A booking reference is required before creating its diary invite.');
  const preferred = clean(booking.calendarId) || bookingCalendarId();
  const calendars = [...new Set([preferred,...(!clean(booking.calendarId)?['primary']:[])])];
  const matches = event => !event?.status || event.status !== 'cancelled';
  const belongs = event => matches(event) && (!extractBookingRefFromCalendarEvent(event) ||
    extractBookingRefFromCalendarEvent(event) === ref ||
    (booking._id && event.extendedProperties?.private?.bookingRecordId === String(booking._id)));
  const read = async (calendarId,eventId) => {
    try {return (await cal.events.get({calendarId,eventId})).data;}
    catch(error){if(missing(error))return null;throw error;}
  };
  const patch = async (calendarId,event) => {
    const requestBody={...payload,attendees:bookingCalendarAttendees(event.attendees,assignments)};
    const updated=await cal.events.patch({calendarId,eventId:event.id,requestBody,sendUpdates:'all'});
    return {calendarId,eventId:event.id,event:updated.data,created:false};
  };

  if (clean(booking.calendarEventId)) {
    for (const calendarId of calendars) {
      const event=await read(calendarId,booking.calendarEventId);
      if(event && belongs(event))return patch(calendarId,event);
    }
  }
  const exact=[];
  for(const calendarId of calendars) {
    const result=await cal.events.list({calendarId,privateExtendedProperty:[`bookingRef=${ref}`],singleEvents:true,maxResults:20,showDeleted:false});
    for(const event of result.data.items || [])if(matches(event))exact.push({calendarId,event});
  }
  if(exact.length>1)throw review('This booking has multiple diary invites. Reconcile them before sending another.');
  if(exact.length===1)return patch(exact[0].calendarId,exact[0].event);

  const stableId=stableBookingEventId(booking);
  const stable=await read(preferred,stableId);
  if(stable){if(!belongs(stable))throw review('The saved diary identity needs review before this booking can be invited.');return patch(preferred,stable);}

  // Imported diary entries may predate booking-reference metadata. Reuse only
  // an unambiguous exact client/event and venue match; hold uncertain matches.
  const date=payload.start?.dateTime?.slice(0,10);
  if(date){
    const end=new Date(`${date}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
    const likely=[];
    for(const calendarId of calendars){
      const result=await cal.events.list({calendarId,timeMin:`${date}T00:00:00Z`,timeMax:`${end.toISOString().slice(0,10)}T00:00:00Z`,singleEvents:true,maxResults:250,showDeleted:false});
      if(result.data.nextPageToken)throw review('The diary has too many entries to safely identify this booking automatically.');
      for(const event of result.data.items || []){
        const priv=event.extendedProperties?.private || {};
        if(!matches(event)||extractBookingRefFromCalendarEvent(event)||priv.parentBookingRef||/enquiry|session/i.test(priv.kind||'')||/enquiry only/i.test(event.summary||''))continue;
        const sameName=normal(event.summary?.split('|')[0])===normal(payload.summary?.split('|')[0]);
        const sameVenue=normal(event.location) && normal(event.location)===normal(payload.location);
        if(sameName||sameVenue)likely.push({calendarId,event,exact:!!(sameName&&sameVenue)});
      }
    }
    if(likely.length===1&&likely[0].exact)return patch(likely[0].calendarId,likely[0].event);
    if(likely.length)throw review('A possible existing diary entry needs linking to this booking before creating another invite.');
  }
  const requestBody={...payload,id:stableId,attendees:bookingCalendarAttendees([],assignments)};
  try{
    const created=await cal.events.insert({calendarId:preferred,requestBody,sendUpdates:'all'});
    return {calendarId:preferred,eventId:created.data.id,event:created.data,created:true};
  }catch(error){
    if(Number(error?.code||error?.status)!==409)throw error;
    const winner=await read(preferred,stableId);
    if(!winner||!belongs(winner))throw review('The diary invite was created concurrently and needs review.');
    return patch(preferred,winner);
  }
}
