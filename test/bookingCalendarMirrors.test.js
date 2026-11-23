import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingCalendarAttendees,syncBookingCalendarMirrors} from '../utils/bookingCalendarMirrors.js';

const assignments=[{email:'josh@example.test',status:'confirmed'},{email:'matt@example.test',status:'offered'},
  {email:'david@example.test',status:'withdrawn'},{email:'rowan@googlemail.com',status:'confirmed'}];
test('adds confirmed musicians, removes withdrawn guests, preserves real RSVPs and deduplicates Google aliases',()=>{
  const guests=bookingCalendarAttendees([{email:'david@example.test',responseStatus:'accepted'},
    {email:'rowan@gmail.com',responseStatus:'accepted'},{email:'admin@example.test',responseStatus:'accepted'}],assignments);
  assert.equal(guests.length,3);
  assert.deepEqual(guests.find(g=>g.email==='rowan@googlemail.com'),{email:'rowan@googlemail.com',responseStatus:'accepted'});
  assert.deepEqual(guests.find(g=>g.email==='josh@example.test'),{email:'josh@example.test'});
  assert.ok(!guests.some(g=>/matt|david/.test(g.email)));
});
test('updates only the explicitly linked matching booking; preserves times and notifies attendees',async()=>{
  const writes=[];const mirrors=[{calendarId:'gigs',eventId:'shared'},{calendarId:'primary',eventId:'main'},
    {calendarId:'gigs',eventId:'other-booking'},{calendarId:'gigs',eventId:'shared'}];
  const cal={events:{get:async({eventId})=>({data:{description:`Booking Reference: ${eventId==='shared'?'REF':'OTHER'}`,
    start:{dateTime:'2026-12-31T17:00:00Z'},attendees:[{email:'rowan@gmail.com',responseStatus:'accepted'}]}}),
    patch:async args=>writes.push(args)}};
  await syncBookingCalendarMirrors({cal,booking:{bookingId:'REF',calendarMirrors:mirrors},calendarId:'primary',eventId:'main',
    payload:{summary:'Wedding | Band',description:'Booking Reference: REF\nUpdated lineup',location:'Venue'},assignments});
  assert.equal(writes.length,1);assert.equal(writes[0].eventId,'shared');assert.equal(writes[0].sendUpdates,'all');
  assert.equal(writes[0].requestBody.start,undefined);assert.equal(writes[0].requestBody.attendees.length,2);
});
test('unchanged copies and deleted events do not create or resend invitations',async()=>{
  const payload={summary:'Wedding',description:'Booking Reference: REF',location:'Venue'};
  const cal={events:{get:async({eventId})=>{if(eventId==='gone')throw {code:404};return {data:{...payload,attendees:[]}};},
    patch:async()=>{throw Error('unexpected resend');}}};
  await syncBookingCalendarMirrors({cal,booking:{bookingId:'REF',calendarMirrors:[{calendarId:'gigs',eventId:'shared'},
    {calendarId:'gigs',eventId:'gone'}]},calendarId:'primary',eventId:'main',payload});
});
