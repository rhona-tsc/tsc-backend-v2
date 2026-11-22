import test from 'node:test';
import assert from 'node:assert/strict';
import {withinAllocationWeek,activeAllocationHold,bookingRolePlan,assignmentForSlot,confirmedAllocation,activeBooking,londonDay} from '../utils/bookingAllocationPolicy.js';
import {actRoleDeputies} from '../utils/actRoleDeputies.js';
test('seven-day window is inclusive and uses the London day, including BST',()=>{
 const now=new Date('2026-11-22T10:00:00Z');
 assert.equal(withinAllocationWeek('2026-11-29',now),true);assert.equal(withinAllocationWeek('2026-11-30',now),false);assert.equal(withinAllocationWeek('2026-11-21',now),false);
 assert.equal(londonDay(new Date('2026-06-01T23:30:00Z')),'2026-06-02');
});
test('a role hold wins even inside the final week, expires only at its end, and never leaks to another role',()=>{
 const now=new Date('2026-11-22T10:00:00Z');const hold={roleSlotId:'keyboard-1',active:true,reason:'Awaiting client'};
 assert.equal(activeAllocationHold({allocationHolds:[hold]},'keyboard-1',now),hold);
 assert.equal(activeAllocationHold({allocationHolds:[hold]},'drums-1',now),undefined);
 assert.equal(activeAllocationHold({allocationHolds:[hold]},'keys-1',now),hold);
 assert.equal(activeAllocationHold({allocationHolds:[{...hold,until:new Date(+now-1)}]},'keyboard-1',now),undefined);
 assert.equal(activeAllocationHold({allocationHolds:[{...hold,active:false}]},'keyboard-1',now),undefined);
});
test('repeated roles and aliases resolve separate seats; pending and withdrawn allocations never count as filled',()=>{
 const board={lineupComposition:['Female Lead Vocals','Lead Female Vocal','Keys','Bass'],assignedMusicians:[{role:'Lead Female Vocal',roleSlotId:'lead-female-vocal-2',status:'confirmed'},{role:'Keys',roleSlotId:'keys-1',status:'accepted'},{role:'Bass',status:'offered'}]};
 const plan=bookingRolePlan(board);
 assert.equal(assignmentForSlot(board,plan[0],plan),null);
 assert.equal(confirmedAllocation(assignmentForSlot(board,plan[1],plan)),true);
 assert.equal(confirmedAllocation(assignmentForSlot(board,plan[2],plan)),true);
 assert.equal(confirmedAllocation(assignmentForSlot(board,plan[3],plan)),false);
 assert.equal(confirmedAllocation({status:'confirmed',withdrawnAt:new Date()}),false);
});
test('imported contract labels do not invent unknown roles; additional musicians remain separate',()=>{
 assert.deepEqual(bookingRolePlan({lineupSelected:'3-Piece'}),[]);
 assert.equal(bookingRolePlan({lineupSelected:'7-piece (2 x lead vocal, bass, keys, guitar, drums, sax), & wireless mic'}).length,7);
 assert.equal(bookingRolePlan({lineupComposition:['Bass'],extras:[{name:'early arrival'},{addsMusician:true,musicianRole:'Saxophone',quantity:2}]}).length,3);
 assert.equal(activeBooking({bookingStatus:'cancelled'}),false);
});
test('act deputies are pooled across same-role lineups, preserve order and region restrictions, and deduplicate exact identities',()=>{
 const a={musicianId:'111',firstName:'A'},b={musicianId:'222',firstName:'B'},n={musicianId:'333',firstName:'N',regions:['north']};
 const member={_id:'keys6',instrument:'Keyboard',deputies:[a]};
 const act={lineups:[{bandMembers:[member]},{bandMembers:[{instrument:'Keys',deputies:[a,b,n]},{instrument:'Drums',deputies:[{musicianId:'drummer'}]}]}]};
 const result=actRoleDeputies({act,lineup:{bandMembers:[member]},member,role:'Keyboard',board:{county:'Hertfordshire'},roleSlotId:'keyboard-1'});
 assert.deepEqual(result.map(x=>x.musicianId),['111','222']);
});
