import test from 'node:test';import assert from 'node:assert/strict';
import {buildHistoricalPerformances,buildHistoricalIdentityIndex,calendarEventDate,mergePerformanceBookings} from '../services/historicalMusicianPerformanceService.js';
const p=(n,extra={})=>({_id:String(n).padStart(24,'0'),email:`person${n}@gmail.com`,status:'approved',...extra});
const profiles=[p(1),p(2),p(3)];
const event=(extra={})=>({id:'gig1',calendarId:'tsc-gigs',summary:"Sarah & Luke’s Wedding",description:'EVENT SHEET: link',status:'confirmed',start:'2025-08-23T17:00:00+01:00',location:'The Hall, London W1A 1AA',attendees:[{email:'person1@gmail.com',response_status:'accepted'},{email:'person2@gmail.com',response_status:'accepted'}],...extra});
const run=(extra={})=>buildHistoricalPerformances({events:[event()],profiles,today:'2026-11-26',...extra});
test('accepted past gig guests form a canonical relationship with private evidence only',()=>{const r=run();assert.equal(r.records.length,1);assert.deepEqual(r.records[0].musicianIds,profiles.slice(0,2).map(p=>p._id));assert.equal(r.records[0].summary,undefined);assert.equal(r.records[0].location,undefined);assert.equal(r.records[0].evidence[0].basis,'accepted_gig_invitation');});
test('declined, tentative, unanswered, optional, resource and unknown guests never create connections',()=>{
 for(const guest of [{response_status:'declined'},{response_status:'tentative'},{response_status:'needsAction'},{response_status:'accepted',optional:true},{response_status:'accepted',resource:true},{response_status:'accepted',email:'client@example.com'}]){
  const e=event();e.attendees[1]={...e.attendees[1],...guest};assert.equal(run({events:[e]}).records.length,0);
 }
});
test('meetings, reminders, cancelled or future events cannot become performances',()=>{for(const extra of [{summary:'Reminder - wedding'},{summary:'Call with band'},{status:'cancelled'},{start:'2027-01-01'},{description:'',summary:'Private appointment'}])assert.equal(run({events:[event(extra)]}).records.length,0);});
test('canonical aliases and googlemail work; ambiguous shared emails and private test profiles remain excluded',()=>{
 const merged=p(9,{email:'old@gmail.com',mergedIntoMusicianId:profiles[0]._id});const index=buildHistoricalIdentityIndex([...profiles,merged,p(8,{email:'person2@gmail.com'})]);assert.equal(index.resolveEmail(' OLD@googlemail.com '),profiles[0]._id);assert.equal(index.resolveEmail('person2@gmail.com'),'');assert.equal(index.ambiguousEmail('person2@gmail.com'),true);
 assert.equal(run({profiles:[p(1,{privateTestProfile:true}),p(2)]}).records.length,0);
 assert.equal(index.resolveMember({musicianId:profiles[0]._id,email:profiles[2].email}),'');
});
test('a linked final allocation overrides old calendar RSVPs and honours withdrawals and later reacceptance',()=>{
 const board={_id:'board1',bookingRef:'REF1',calendarEventId:'gig1',calendarId:'tsc-gigs',eventDateISO:'2025-08-23',assignedMusicians:[{musicianId:profiles[0]._id,status:'confirmed'},{musicianId:profiles[1]._id,status:'withdrawn'},{musicianId:profiles[2]._id,status:'confirmed',withdrawnAt:'2025-08-01',acceptedAt:'2025-08-03'}]};
 const r=run({board:[board]});assert.deepEqual(r.records[0].musicianIds,[profiles[0]._id,profiles[2]._id]);assert.ok(r.records[0].evidence.every(e=>e.basis==='confirmed_allocation'));
 assert.equal(run({board:[{...board,bookingStatus:'cancelled'}]}).records.length,0);
});
test('date, exact venue and normalized client name identify old bookings, while conflicting bookings are held',()=>{
 const board={_id:'board1',bookingRef:'REF1',eventDateISO:'2025-08-23',address:'The Hall, London W1A 1AA',clientFirstNames:'Sarah & Luke',bookingStatus:'cancelled'};
 assert.equal(run({board:[board]}).records.length,0);
 assert.equal(run({board:[{...board,clientFirstNames:'Other client',bookingStatus:'confirmed'}]}).records.length,0);
});
test('board withdrawals do not resurrect stale core allocations and empty board snapshots preserve core evidence',()=>{
 const core={_id:'core1',bookingRef:'REF1',assignedMusicians:[{musicianId:profiles[0]._id,status:'confirmed'}]};
 const board={_id:'board1',bookingId:'core1',assignedMusicians:[{musicianId:profiles[0]._id,status:'withdrawn'}]};assert.equal(mergePerformanceBookings([board],[core]).length,1);assert.equal(mergePerformanceBookings([board],[core])[0].assignedMusicians[0].status,'withdrawn');assert.equal(mergePerformanceBookings([{...board,assignedMusicians:[]}],[core])[0].assignedMusicians[0].status,'confirmed');
});
test('event dates use London including summer timezone and evidence IDs are deterministic for repeat imports',()=>{assert.equal(calendarEventDate({start:'2025-08-23T23:30:00Z'}),'2025-08-24');assert.equal(calendarEventDate({start:new Date('2025-01-01T12:00:00Z')}),'2025-01-01');assert.equal(run().records[0]._id,run().records[0]._id);});

test('public connections consume verified history without exposing calendar or client data',async()=>{
 const {getMusicianConnections}=await import('../services/musicianConnectionsService.js');
 const subject={...p(1),firstName:'Sarah'};const peer={...p(2),firstName:'Bob',lastName:'Brown',musicianSlug:'bob-b',email:'private@example.com',phone:'private'};
 const calls=[];
 const db={collection(name){return{find(query){calls.push({name,query});const rows=name==='musicianperformancehistories'?[{musicianIds:[subject._id,peer._id],sourceEventId:'secret',clientName:'Private client'}]:name==='musicians'?[peer]:[];return{project(){return this},maxTimeMS(){return this},async toArray(){return rows}}}}}};
 const result=await getMusicianConnections(subject,{db,now:new Date('2026-11-26T12:00Z')});assert.equal(result.musicians.length,1);assert.equal(result.musicians[0].href,'/musician/bob-b');assert.doesNotMatch(JSON.stringify(result),/private@example|Private client|secret|phone/);
 assert.equal(calls.find(c=>c.name==='musicianperformancehistories').query.status,'verified');assert.equal(calls.find(c=>c.name==='musicians').query.privateTestProfile.$ne,true);
});

test('an authoritative board withdrawal suppresses stale source-booking connections',async()=>{
 const {getMusicianConnections}=await import('../services/musicianConnectionsService.js');const subject=p(1),peer=p(2);
 const core={_id:'333333333333333333333333',bookingRef:'REF1',eventDateISO:'2025-08-23',assignedMusicians:[{musicianId:subject._id,status:'confirmed'},{musicianId:peer._id,status:'confirmed'}]};
 const board={...core,_id:'444444444444444444444444',bookingId:core._id,assignedMusicians:[{musicianId:subject._id,status:'withdrawn'},{musicianId:peer._id,status:'confirmed'}]};let boardCalls=0;
 const db={collection(name){return{find(){const rows=name==='bookings'?[core]:name==='bookingboarditems'?(boardCalls++?[board]:[]):[];return{project(){return this},maxTimeMS(){return this},async toArray(){return rows}}}}}};
 assert.deepEqual((await getMusicianConnections(subject,{db,now:new Date('2026-11-26T12:00Z')})).musicians,[]);
});
