import test from 'node:test';import assert from 'node:assert/strict';import {syncAdditionalBookingSessions} from '../utils/additionalBookingSessions.js';
const booking={_id:'booking',bookingId:'ref',eventSheet:{bandSheetToken:'token',answers:{additional_calendar_sessions:[{key:'afternoon',dateISO:'2027-04-23',arrivalTime:'14:00',endTime:'17:00',title:'Afternoon set — time TBC',musicianIds:['keys','bass']}]}}};
test('only accepted afternoon participants get invitations; repeated sync is silent',async()=>{
 let existing;const writes=[];const cal={events:{get:async()=>{if(!existing)throw {code:404};return {data:existing};},insert:async args=>{writes.push(args);existing=args.requestBody;},patch:async args=>{writes.push(args);existing={...existing,...args.requestBody};},delete:async args=>{writes.push(args);existing=null;}}};
 const assignments=[{musicianId:'keys',email:'keys@test.com',name:'Keys',status:'offered'},{musicianId:'bass',email:'bass@test.com',name:'Bass',status:'offered'},{musicianId:'guitar',email:'guitar@test.com',status:'confirmed'}];
 await syncAdditionalBookingSessions({cal,calendarId:'cal',booking,assignments});assert.equal(writes.length,0);
 assignments[0].status='accepted';await syncAdditionalBookingSessions({cal,calendarId:'cal',booking,assignments});assert.deepEqual(existing.attendees.map(a=>a.email),['keys@test.com']);assert.equal(writes[0].sendUpdates,'all');assert.equal(existing.extendedProperties.private.bookingRef,undefined);
 await syncAdditionalBookingSessions({cal,calendarId:'cal',booking,assignments});assert.equal(writes.length,1);
 assignments[1].status='confirmed';await syncAdditionalBookingSessions({cal,calendarId:'cal',booking,assignments});assert.equal(existing.attendees.length,2);assert.equal(writes.length,2);
 assignments[0].status='declined';assignments[1].status='withdrawn';await syncAdditionalBookingSessions({cal,calendarId:'cal',booking,assignments});assert.equal(existing,null);
});
