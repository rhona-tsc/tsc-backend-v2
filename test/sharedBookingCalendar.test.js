import test from 'node:test';
import assert from 'node:assert/strict';
import {upsertSharedBookingCalendar as upsert,stableBookingEventId,bookingCalendarId} from '../utils/sharedBookingCalendar.js';

const payload={summary:"Megan's Wedding | Dancefloor Magic",location:'Tewinbury Farm Hotel',description:'Booking Reference: REF',
  start:{dateTime:'2026-12-31T17:00:00'},end:{dateTime:'2027-01-01T00:00:00'},extendedProperties:{private:{bookingRef:'REF',bookingRecordId:'booking'}}};
function fixture(initial=[]){
  const data=new Map(initial.map(event=>[`${event.calendarId}:${event.id}`,structuredClone(event)]));
  const writes=[];
  const cal={events:{
    get:async({calendarId,eventId})=>{const value=data.get(`${calendarId}:${eventId}`);if(!value)throw {code:404};return {data:structuredClone(value)};},
    list:async({calendarId,privateExtendedProperty})=>({data:{items:[...data.values()].filter(event=>event.calendarId===calendarId&&(!privateExtendedProperty||privateExtendedProperty.every(filter=>{const [key,value]=filter.split('=');return event.extendedProperties?.private?.[key]===value;})))}}),
    insert:async args=>{writes.push({kind:'insert',...args});const key=`${args.calendarId}:${args.requestBody.id}`;if(data.has(key))throw {code:409};const event={...args.requestBody,calendarId:args.calendarId};data.set(key,event);return {data:structuredClone(event)};},
    patch:async args=>{writes.push({kind:'patch',...args});const key=`${args.calendarId}:${args.eventId}`;const event={...data.get(key),...args.requestBody};data.set(key,event);return {data:structuredClone(event)};},
  }};
  return {cal,data,writes};
}
const confirmed=[{email:'josh@example.test',status:'confirmed'},{email:'matt@example.test',status:'offered'}];
test('new bookings default to TSC Gigs and retries do not create a second invite',async()=>{
  const f=fixture(),booking={_id:'booking',bookingId:'REF'};
  const first=await upsert({...f,booking,ref:'REF',payload,assignments:confirmed});
  const second=await upsert({...f,booking,ref:'REF',payload,assignments:confirmed});
  assert.equal(first.calendarId,bookingCalendarId());assert.equal(first.eventId,second.eventId);
  assert.equal(f.data.size,1);assert.deepEqual(first.event.attendees,[{email:'josh@example.test'}]);
});
test('concurrent creation uses one stable Google event ID and recovers the insert conflict',async()=>{
  const f=fixture(),booking={_id:'same-booking',bookingId:'REF',calendarId:'gigs'};
  const results=await Promise.all([1,2].map(()=>upsert({...f,booking,ref:'REF',payload,assignments:confirmed})));
  assert.equal(f.data.size,1);assert.equal(results[0].eventId,results[1].eventId);
  assert.equal(f.writes.filter(w=>w.kind==='insert').length,2);
});
test('a saved older primary-calendar event is reused when its calendar ID was missing',async()=>{
  const f=fixture([{id:'legacy',calendarId:'primary',...payload,attendees:[{email:'josh@example.test',responseStatus:'accepted'}]}]);
  const result=await upsert({...f,booking:{_id:'booking',bookingId:'REF',calendarEventId:'legacy'},ref:'REF',payload,assignments:confirmed});
  assert.equal(result.calendarId,'primary');assert.equal(result.eventId,'legacy');assert.equal(f.data.size,1);
  assert.equal(result.event.attendees[0].responseStatus,'accepted');
});
test('a missing saved ID reuses the existing reference-tagged invite',async()=>{
  const f=fixture([{id:'existing',calendarId:'gigs',...payload}]);
  const result=await upsert({...f,booking:{_id:'booking',bookingId:'REF',calendarId:'gigs'},ref:'REF',payload});
  assert.equal(result.eventId,'existing');assert.equal(f.data.size,1);
});
test('a legacy imported diary entry is adopted only with matching client/event and venue',async()=>{
  const f=fixture([{id:'old-import',calendarId:'gigs',summary:"Megan's Wedding",location:payload.location,start:payload.start}]);
  const result=await upsert({...f,booking:{_id:'booking',bookingId:'REF',calendarId:'gigs'},ref:'REF',payload});
  assert.equal(result.eventId,'old-import');assert.equal(f.data.size,1);
});
test('ambiguous legacy entries and existing duplicate references block new invitations',async()=>{
  for(const initial of [
    [{id:'possible',calendarId:'gigs',summary:'Different client',location:payload.location}],
    ['one','two'].map(id=>({id,calendarId:'gigs',...payload})),
  ]){
    const f=fixture(initial);
    await assert.rejects(upsert({...f,booking:{_id:'booking',bookingId:'REF',calendarId:'gigs'},ref:'REF',payload}),{code:'BOOKING_CALENDAR_REVIEW_REQUIRED'});
    assert.equal(f.writes.length,0);
  }
});
test('two bookings for the same act and day retain separate stable identities',()=>{
  assert.notEqual(stableBookingEventId({_id:'one'}),stableBookingEventId({_id:'two'}));
  assert.match(stableBookingEventId({_id:'one'}),/^[0-9a-v]+$/);
});
test('calendar permission/API failures never trigger a fallback duplicate',async()=>{
  const f=fixture();f.cal.events.get=async()=>{throw {code:403};};
  await assert.rejects(upsert({...f,booking:{_id:'booking',bookingId:'REF',calendarId:'gigs',calendarEventId:'existing'},ref:'REF',payload}));
  assert.equal(f.writes.length,0);
});
