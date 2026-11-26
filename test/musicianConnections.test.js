import test from 'node:test';
import assert from 'node:assert/strict';
import {splitBandMemberships, confirmedRoster, completedBooking, publicMusician, musicianConnectionCard} from '../services/musicianConnectionsService.js';
const musician = {_id:'111111111111111111111111',email:'singer@example.com',status:'approved'};
const act = (id,members,status='approved') => ({_id:id,tscName:`Band ${id}`,slug:`band-${id}`,status,coverImage:[{url:'https://example.com/photo.jpg'}],lineups:[{bandMembers:members}]});
test('regular and deputy acts use canonical IDs or case-insensitive legacy emails, deduplicating lineups',()=>{
 const regular=act('1',[{email:'SINGER@example.com',deputies:[{musicianId:musician._id}]}]);
 const dep=act('2',[{deputies:[{musicianId:musician._id}]}]);
 const result=splitBandMemberships(musician,[regular,regular,dep,act('3',[{musicianId:musician._id}],'pending')]);
 assert.deepEqual(result.regularBands.map(x=>x._id),['1']);assert.deepEqual(result.deputyBands.map(x=>x._id),['2']);
 assert.equal(result.regularBands[0].href,'/act/band-1/'); assert.equal(result.regularBands[0].email,undefined);
});
test('co-performers require completed events and final accepted roles, including reacceptance after withdrawal',()=>{
 const b={eventDateISO:'2026-10-29',assignedMusicians:[{status:'offered'}, {status:'confirmed',withdrawnAt:'2026-10-21T12:00Z'}, {status:'confirmed',withdrawnAt:'2026-10-21T12:00Z',acceptedAt:'2026-10-21T16:00Z'}, {status:'accepted'}]};
 assert.equal(completedBooking(b,'2026-11-26'),true);assert.equal(confirmedRoster(b).length,2);
 assert.equal(completedBooking({...b,bookingStatus:'cancelled'},'2026-11-26'),false);
 assert.equal(completedBooking({...b,eventDateISO:'2026-12-01'},'2026-11-26'),false);
});
test('public cards exclude hidden, deleted, pending and merged musicians and never return contact information',()=>{
 for(const extra of [{privateTestProfile:true},{profileDeletedAt:new Date()},{status:'pending'},{mergedIntoMusicianId:'x'}])assert.equal(publicMusician({...musician,...extra}),false);
 const card=musicianConnectionCard({...musician,firstName:'Sarah',lastName:'Smith',musicianSlug:'sarah-s',profilePhoto:'photo.jpg',phone:'private'});
 assert.equal(card.name,'Sarah S'); assert.equal(card.href,'/musician/sarah-s');assert.equal(card.email,undefined);assert.equal(card.phone,undefined);
});
