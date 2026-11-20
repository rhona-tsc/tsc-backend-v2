import crypto from 'node:crypto';
import {buildBandSheetShareUrl} from './bandSheetUrl.js';
const clean = value => String(value || '').trim();
const accepted = member => ['accepted','confirmed'].includes(clean(member.status).toLowerCase());

// Extra sessions use their own deterministic calendar identity. They must never
// be mistaken for the shared main booking event when its stored id is missing.
export async function syncAdditionalBookingSessions({cal,calendarId,booking,assignments=[]}) {
  const sessions=booking?.eventSheet?.answers?.additional_calendar_sessions;
  if(!Array.isArray(sessions)) return;
  for(const session of sessions) {
    if(!session.key || !/^\d{4}-\d{2}-\d{2}$/.test(session.dateISO || '') ||
       !/^\d{2}:\d{2}$/.test(session.arrivalTime || '') || !/^\d{2}:\d{2}$/.test(session.endTime || '')) continue;
    const allowed=new Set((session.musicianIds || []).map(String));
    const members=assignments.filter(member=>accepted(member)&&allowed.has(String(member.musicianId))&&clean(member.email));
    const eventId='tsc'+crypto.createHash('sha256').update(`${booking._id}:${session.key}`).digest('hex').slice(0,40);
    let existing;
    try {existing=(await cal.events.get({calendarId,eventId})).data;}
    catch(error) {if(![404,410].includes(Number(error.code || error.status)))throw error;}
    if(!members.length) {
      if(existing && existing.status!=='cancelled') await cal.events.delete({calendarId,eventId,sendUpdates:'all'});
      continue;
    }
    const bandLink=booking.eventSheet?.bandSheetToken ? buildBandSheetShareUrl(booking.eventSheet.bandSheetToken) : '';
    const publicBase=clean(process.env.PUBLIC_SITE_URL || 'https://thesupremecollective.co.uk').replace(/\/$/,'');
    const attendees=members.map(member=>{
      const email=clean(member.email).toLowerCase();
      const prior=existing?.attendees?.find(item=>item.email?.toLowerCase()===email);
      return {email,...(prior?.responseStatus?{responseStatus:prior.responseStatus}:{})};
    });
    const requestBody={
      summary:clean(session.title), location:clean(session.location || booking.venueAddress || booking.venue),
      description:[`Parent booking: ${booking.bookingId}`,clean(session.notes),'',...members.map(member=>`${clean(member.name)} — ${clean(member.role || member.instrument)}\n${publicBase}/musician/${encodeURIComponent(member.musicianId)}/`),'',`BAND EVENT SHEET: ${bandLink}`].join('\n'),
      start:{dateTime:`${session.dateISO}T${session.arrivalTime}:00`,timeZone:'Europe/London'},
      end:{dateTime:`${session.dateISO}T${session.endTime}:00`,timeZone:'Europe/London'},
      attendees,extendedProperties:{private:{parentBookingRef:clean(booking.bookingId),additionalSessionKey:clean(session.key)}}
    };
    const emails=value=>(value || []).map(item=>item.email?.toLowerCase()).sort().join(',');
    const unchanged=existing && existing.status!=='cancelled' && existing.summary===requestBody.summary &&
      existing.description===requestBody.description && existing.location===requestBody.location &&
      existing.start?.dateTime?.slice(0,16)===requestBody.start.dateTime.slice(0,16) &&
      existing.end?.dateTime?.slice(0,16)===requestBody.end.dateTime.slice(0,16) && emails(existing.attendees)===emails(attendees);
    if(unchanged)continue;
    if(existing && existing.status!=='cancelled') await cal.events.patch({calendarId,eventId,requestBody,sendUpdates:'all'});
    else await cal.events.insert({calendarId,requestBody:{id:eventId,...requestBody},sendUpdates:'all'});
  }
}
