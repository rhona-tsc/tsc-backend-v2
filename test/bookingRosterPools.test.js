import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingPoolRegions, rosterEligibilityForBooking, eligibleDeputiesForBooking} from '../utils/bookingRosterPools.js';
import {actRoleDeputies} from '../utils/actRoleDeputies.js';
import {bookingRosterEligibility} from '../services/rosterEligibilityService.js';
import Policy from '../models/actRosterPolicy.js';

const south={musicianId:'south-player',name:'Southern Player',regions:['south'],regionalPriority:{south:0}};
const shared={musicianId:'shared-player',name:'Shared Player',regions:['south','north'],regionalPriority:{south:1,north:1}};
const north={musicianId:'north-player',name:'Northern Player',regions:['north'],regionalPriority:{north:0}};
const member={instrument:'Saxophone',deputies:[south,shared,north]};
const lineup={bandMembers:[member]};
const board={county:'Warwickshire',allocationPoolOverrides:[{roleSlotId:'saxophone-1',regions:['south','north'],reason:'Owner approved southern deputies before the northern pool'}]};
const context={board,roleSlotId:'saxophone-1',member,lineup,county:board.county};

test('a saved booking-role instruction tries the southern pool first, then northern, without duplicate offers',()=>{
 assert.deepEqual(eligibleDeputiesForBooking(context).map(p=>p.musicianId),['south-player','shared-player','north-player']);
 assert.equal(rosterEligibilityForBooking({...context,candidate:south}).eligible,true);
 assert.equal(rosterEligibilityForBooking({...context,candidate:north}).eligible,true);
 assert.equal(rosterEligibilityForBooking({...context,candidate:{musicianId:'scottish-player',regions:['scotland']},member:{...member,deputies:[{musicianId:'scottish-player',regions:['scotland']}]}}).eligible,false);
});
test('the instruction never changes another role, booking, venue or the global roster',()=>{
 assert.deepEqual(eligibleDeputiesForBooking({...context,roleSlotId:'trumpet-1'}).map(p=>p.musicianId),['north-player','shared-player']);
 assert.deepEqual(eligibleDeputiesForBooking({...context,board:{county:'Warwickshire'}}).map(p=>p.musicianId),['north-player','shared-player']);
 assert.equal(board.county,'Warwickshire');assert.deepEqual(south.regions,['south']);
 assert.deepEqual(bookingPoolRegions({allocationPoolOverrides:[{roleSlotId:'saxophone-1',regions:['south'],reason:''}]},'saxophone-1'),[]);
});
test('cross-region approval preserves musician-combination exclusions',()=>{
 const policy={exclusions:[{person:{musicianId:south.musicianId},withPeople:[{musicianId:'incompatible-player'}],reason:'Do not pair these musicians'}]};
 const blocked={...context,policy,assignments:[{musicianId:'incompatible-player',status:'confirmed',roleSlotId:'bass-1'}]};
 assert.equal(rosterEligibilityForBooking({...blocked,candidate:south}).eligible,false);
 assert.ok(!eligibleDeputiesForBooking(blocked).some(p=>p.musicianId===south.musicianId));
});
test('automatic deputy fallback respects region order even when deputies come from different lineups',()=>{
 const main={instrument:'Saxophone',deputies:[north]},other={instrument:'Saxophone',deputies:[south]};
 const act={lineups:[{bandMembers:[main]},{bandMembers:[other]}]};
 assert.deepEqual(actRoleDeputies({act,lineup:{bandMembers:[main]},member:main,role:'Saxophone',board,roleSlotId:'saxophone-1'}).map(p=>p.musicianId),['south-player','north-player']);
});
test('manual offers and subsequent acceptance use the same approved pool rule',async t=>{
 t.mock.method(Policy,'findOne',()=>({lean:async()=>({exclusions:[]})}));
 const result=await bookingRosterEligibility({act:{_id:'example'},lineup,board,candidate:south,member,roleSlotId:'saxophone-1'});
 assert.equal(result.eligible,true);
 const normal=await bookingRosterEligibility({act:{_id:'example'},lineup,board:{county:'Warwickshire'},candidate:south,member,roleSlotId:'saxophone-1'});
 assert.equal(normal.eligible,false);
});
