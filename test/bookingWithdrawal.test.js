import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import Board from '../models/bookingBoardItem.js';
import Act from '../models/actModel.js';
import Availability from '../models/availabilityModel.js';
import Message from '../models/EnquiryMessage.js';
import Job from '../models/deputyJobModel.js';
import Booking from '../models/bookingModel.js';
import Musician from '../models/musicianModel.js';
import Policy from '../models/actRosterPolicy.js';
import {isExplicitAvailabilityDecline} from '../services/availabilityPriorDeclines.js';
import { ownsBookingAssignment, isWithdrawalTarget, withdrawalAvailabilityRecord } from '../utils/bookingWithdrawal.js';
process.env.JWT_SECRET='withdrawal-route-test';
process.env.STRIPE_SECRET_KEY='sk_test_withdrawal';process.env.STRIPE_SECRET_KEY_V2='sk_test_withdrawal';
process.env.GOOGLE_REFRESH_TOKEN='';
const {default:allocationRoutes}=await import('../routes/allocationRoutes.js');
const {default:bookingRoutes}=await import('../routes/bookingRoutes.js');
const person='111111111111111111111111',boardId='222222222222222222222222',actId='333333333333333333333333';
const assignment=()=>({musicianId:person,email:'musician@example.test',phone:'+447000000001',name:'Example Keyboard',role:'Keyboard',roleSlotId:'keyboard-1',fee:400,totalFee:400,status:'confirmed'});
async function setup(t) {
 t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});
 const keys=assignment(),other={...keys,role:'Guitar',roleSlotId:'guitar-1'};
 const rows=[keys,other,{...keys,musicianId:'444444444444444444444444',email:'someoneelse@example.test',role:'Drums',roleSlotId:'drums-1'}];
 const board={_id:boardId,bookingRef:'EXAMPLE-BOOKING',actId,eventDateISO:'2099-12-31',address:'Example venue',county:'Hertfordshire',arrivalTime:'17:00',assignedMusicians:rows.map(x=>({...x})),bookingMusicians:rows.map(x=>({...x})),bandLineup:rows.map(x=>({...x})),bookingDetails:{assignedMusicians:rows.map(x=>({...x}))},allocation:{},allocationHolds:[],lineupComposition:['Keyboard','Guitar','Drums'],save:async()=>{}};
 let availability=[],jobs=[];
 t.mock.method(Board,'findOne',async()=>board);t.mock.method(Board,'findById',()=>({lean:async()=>board,then:(resolve,reject)=>Promise.resolve(board).then(resolve,reject)}));
 t.mock.method(Act,'findById',()=>({lean:async()=>({_id:actId,tscName:'Example band',lineups:[]})}));
 t.mock.method(Policy,'findOne',()=>({lean:async()=>null}));
 t.mock.method(Message,'findOne',()=>({sort:async()=>null}));
 t.mock.method(Message,'exists',async()=>null);
 t.mock.method(Availability,'findOneAndUpdate',async(_filter,update)=>{availability.push(update.$set);return update.$set});
 t.mock.method(Availability,'updateMany',async()=>({modifiedCount:0}));
 t.mock.method(Booking,'findOne',()=>({lean:async()=>({_id:'core-booking'})}));
 const coreWrites=[];
 t.mock.method(Booking.collection,'updateOne',async(_filter,update)=>{coreWrites.push(update.$set);return {modifiedCount:1};});
 t.mock.method(Job,'findOne',async query=>jobs.find(job=>job.automation?.roleSlotId===query['automation.roleSlotId'])||null);
 t.mock.method(Job,'create',async value=>{const job={...value,_id:'555555555555555555555555'};jobs.push(job);return job;});
 const app=express();app.use(express.json());app.use('/api/allocations',allocationRoutes);app.use('/api/booking',bookingRoutes);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,user=person,body={roleSlotId:'keyboard-1',reason:'Out of the country'})=>{
  const r=await fetch(`${url}${path}/bookings/EXAMPLE-BOOKING/withdraw`,{method:'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${jwt.sign({id:user},process.env.JWT_SECRET)}`}:{})},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};
 };
 return{board,availability,jobs,request,url,coreWrites};
}
test('current and cached portal URLs both withdraw only the owned keyboard role and open a deputy job',async t=>{
 for(const prefix of ['/api/allocations','/api/booking']) {
  await t.test(prefix,async t=>{
   const f=await setup(t);const r=await f.request(prefix);
   assert.equal(r.status,200);assert.equal(r.data.success,true);assert.equal(r.data.reallocationRoute,'job_board_created');
   assert.equal(f.availability.length,1);assert.equal(f.availability[0].reply,'unavailable');assert.equal(f.availability[0].status,'unavailable');assert.equal(f.availability[0].dateISO,'2099-12-31');
   assert.equal(f.coreWrites[0].assignedMusicians[0].status,'withdrawn');
   assert.equal(f.coreWrites[0].assignedMusicians[1].status,'confirmed');
   for(const entries of [f.board.assignedMusicians,f.board.bookingMusicians,f.board.bandLineup,f.board.bookingDetails.assignedMusicians]){
    assert.ok(entries[0].withdrawnAt);assert.equal(entries[0].status,'posted_to_job_board');assert.equal(entries[1].status,'confirmed');assert.equal(entries[2].status,'confirmed');
   }
   assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].fee,400);assert.equal(f.jobs[0].callTime,'17:00');assert.equal(f.jobs[0].eventDate,'2099-12-31');assert.equal(f.jobs[0].status,'open');
   const repeat=await f.request(prefix);assert.equal(repeat.status,200);assert.equal(repeat.data.alreadyWithdrawn,true);assert.equal(f.jobs.length,1);assert.equal(f.availability.length,1);
  });
 }
});
test('anonymous and unrelated musicians cannot cancel an allocation or contact deputies',async t=>{
 const f=await setup(t);assert.equal((await f.request('/api/allocations',null)).status,401);
 assert.equal((await f.request('/api/allocations','666666666666666666666666')).status,404);
 assert.equal(f.jobs.length,0);assert.equal(f.availability.length,0);assert.equal(f.board.assignedMusicians[0].status,'confirmed');
});
test('ownership supports exact account email but never name-only matching or another role',()=>{
 const a=assignment();assert.equal(ownsBookingAssignment(a,{email:' MUSICIAN@EXAMPLE.TEST '}),true);assert.equal(ownsBookingAssignment(a,{name:a.name,id:'other'}),false);
 assert.equal(isWithdrawalTarget({...a,roleSlotId:'guitar-1'},a,{id:person}),false);
 assert.equal(isWithdrawalTarget({...a,musicianId:'other',email:'other@example.test'},a,{id:person}),false);
});
test('manual withdrawal records a stable date-specific unavailability without pretending a message was sent',()=>{
 const row=withdrawalAvailabilityRecord({board:{_id:boardId,bookingRef:'EXAMPLE',eventDateISO:'2099-12-31',actId},assignment:assignment(),phone:'+447000000001',reason:'Away',source:'admin_whatsapp',now:new Date()});
 assert.equal(row.reply,'unavailable');assert.equal(row.status,'unavailable');assert.equal(row.musicianId,person);assert.equal(row.outboundSentAt,undefined);assert.equal(row.inbound.body,'Away');
 const recipient={musicianId:assignment().musicianId,phone:row.phone,dateISO:row.dateISO};
 assert.equal(isExplicitAvailabilityDecline(row,recipient),true);
 assert.throws(()=>withdrawalAvailabilityRecord({board:{_id:boardId},assignment:assignment()}),/event date/);
});

test('website quick-reply corrections withdraw confirmed allocations and mirror core status before deputy routing',async t=>{
 const f=await setup(t);const {withdrawBookingForAvailability}=await import('../controllers/allocationController.js');
 const row={bookingId:'EXAMPLE-BOOKING',musicianId:person,inbound:{source:'website-quick-reply',body:'Unavailable for this venue'}};
 assert.equal(await withdrawBookingForAvailability(row,'yes'),false);
 assert.equal(await withdrawBookingForAvailability(row,'noloc'),true);
 assert.equal(f.availability[0].reply,'no');
 assert.equal(f.coreWrites[0].assignedMusicians[0].status,'withdrawn');
 assert.equal(f.jobs.length,2); // This musician held two distinct roles in the fixture.
 const count=f.availability.length;
 assert.equal(await withdrawBookingForAvailability(row,'noloc'),true);
 assert.equal(f.availability.length,count);
});
test('replacement offers and acceptances update every saved booking allocation mirror',async t=>{
 const f=await setup(t);const {updateBoardRoleSlot}=await import('../controllers/allocationController.js');
 const replacement='777777777777777777777777';
 await updateBoardRoleSlot({bookingBoardItemId:boardId,roleSlotId:'keyboard-1'},{musicianId:replacement,name:'Replacement Musician',status:'offered'});
 await updateBoardRoleSlot({bookingBoardItemId:boardId,roleSlotId:'keyboard-1'},{musicianId:replacement,name:'Replacement Musician',status:'confirmed'});
 const write=f.coreWrites.at(-1);
 for(const field of ['assignedMusicians','bookingMusicians','bandLineup','bookingDetails.assignedMusicians']){
  assert.equal(write[field][0].musicianId,replacement);assert.equal(write[field][0].status,'confirmed');assert.equal(write[field][0].fee,400);
  assert.equal(write[field][1].musicianId,person);assert.equal(write[field][1].status,'confirmed');
 }
});

test('role holds require admin access, a reason and an unfilled role, and preserve fee and other roles',async t=>{
 const f=await setup(t);t.mock.method(Job,'updateMany',async()=>({modifiedCount:0}));
 const post=async(body,role='admin')=>{
  const r=await fetch(`${f.url}/api/allocations/bookings/${boardId}/hold`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({id:person,role},process.env.JWT_SECRET)}`},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};
 };
 assert.equal((await post({roleSlotId:'keyboard-1',active:true,reason:'Client checking'},'musician')).status,403);
 assert.equal((await post({roleSlotId:'keyboard-1',active:true,reason:'Client checking'})).status,409);
 f.board.assignedMusicians[0].status='offered';
 assert.equal((await post({roleSlotId:'keyboard-1',active:true})).status,400);
 assert.equal((await post({roleSlotId:'keyboard-1',active:true,reason:'Client checking',until:'2000-01-01'})).status,400);
 const held=await post({roleSlotId:'keyboard-1',active:true,reason:'Client checking'});
 assert.equal(held.status,200);assert.equal(held.data.allocationHolds[0].active,true);
 assert.equal(f.board.assignedMusicians[0].fee,400);assert.equal(f.board.assignedMusicians[1].status,'confirmed');
 const released=await post({roleSlotId:'keyboard-1',active:false});assert.equal(released.status,200);assert.equal(released.data.allocationHolds[0].active,false);
});

test('the deadline worker posts only eligible unfilled roles and respects holds, client approval and missing fees',async t=>{
 const {runBookingAllocationEscalation}=await import('../services/bookingAllocationReview.js');
 const posted=[];let unlocked=false;
 const slot={role:'Keyboard',roleSlotId:'keyboard-1',fee:400};
 const row={board:{_id:boardId,bookingRef:'EXAMPLE',eventDateISO:'2099-12-31',address:'Venue'},act:{_id:actId},urgent:true,slots:[slot]};
 const rows=[row,{...row,slots:[{...slot,hold:{reason:'Waiting'}}]},{...row,slots:[{...slot,clientApprovalRequired:true}]},{...row,slots:[{...slot,fee:0}]},{...row,urgent:false}];
 const result=await runBookingAllocationEscalation({review:async()=>rows,postRole:async msg=>{posted.push(msg);return{_id:'job'};},locks:{findOneAndUpdate:async()=>({}),deleteOne:async()=>{unlocked=true;}},jobs:{find:async()=>[]}});
 assert.equal(posted.length,1);assert.equal(posted[0].fee,400);assert.equal(unlocked,true);assert.deepEqual(result.outcomes.filter(x=>x.blocked).map(x=>x.blocked),['held','client_approval_required','fee_not_recorded']);
});

test('a richer core booking cannot overwrite the board’s role hold with an empty array',async()=>{
 const {mergeRowData}=await import('../routes/bookingBoardRoutes.js');
 const hold={roleSlotId:'keyboard-1',active:true,reason:'Waiting for client'};
 const board={_id:boardId,bookingBoardItemId:boardId,allocationHolds:[hold]};
 const core={_id:'core-booking',allocationHolds:[]};
 assert.deepEqual(mergeRowData(core,board).allocationHolds,[hold]);
 assert.deepEqual(mergeRowData(board,core).allocationHolds,[hold]);
});

test('cancellations use the job board through day seven, then the act deputies from day eight',async t=>{
 const f=await setup(t);
 const date=new Date();date.setUTCDate(date.getUTCDate()+8);f.board.eventDateISO=date.toISOString().slice(0,10);
 const next='777777777777777777777777';
 const member={_id:'888888888888888888888888',musicianId:person,instrument:'Keyboard',deputies:[{musicianId:next,firstName:'Next',lastName:'Deputy',phone:'+447000000002'}]};
 t.mock.method(Act,'findById',()=>({lean:async()=>({_id:actId,lineups:[{_id:'999999999999999999999999',bandMembers:[member]}]})}));
 t.mock.method(Policy,'findOne',()=>({lean:async()=>null}));
 t.mock.method(Message,'find',()=>({lean:async()=>[]}));
 t.mock.method(Availability,'find',()=>({select:()=>({lean:async()=>[]})}));
 t.mock.method(Musician,'findOne',()=>({select:()=>({lean:async()=>({_id:next,firstName:'Next',lastName:'Deputy',phone:'+447000000002'})})}));
 t.mock.method(Board,'exists',async()=>false);
 // The same prior-decline reader checks booking requests as well as availability.
 t.mock.method(Message,'find',()=>({lean:async()=>[],select:()=>({lean:async()=>[]})}));
 const {escalateToNextDeputy}=await import('../controllers/allocationController.js');
 const result=await escalateToNextDeputy({actId,bookingBoardItemId:boardId,bookingRef:f.board.bookingRef,roleSlotId:'keyboard-1',musicianId:person,phone:'+447000000001',fee:400,meta:{role:'Keyboard',MetaISODate:f.board.eventDateISO}},{dryRun:true});
 assert.equal(result.route,'act_deputy');assert.equal(String(result.musicianId),next);assert.equal(f.jobs.length,0);
 for (const days of [1,7]) {
  const urgentDate=new Date();urgentDate.setUTCDate(urgentDate.getUTCDate()+days);f.board.eventDateISO=urgentDate.toISOString().slice(0,10);
  const urgent=await escalateToNextDeputy({actId,bookingBoardItemId:boardId,bookingRef:f.board.bookingRef,roleSlotId:'keyboard-1',musicianId:person,phone:'+447000000001',fee:400,meta:{role:'Keyboard',MetaISODate:f.board.eventDateISO}},{dryRun:true});
  assert.equal(urgent.route,'job_board');assert.equal(urgent.reason,'within_seven_days');
 }
});

test('outside seven days an unanswered act-deputy request prevents public posting',async t=>{
 const f=await setup(t);t.mock.method(Message,'exists',async()=>({_id:'pending-deputy'}));
 const {postExhaustedRoleToDeputyBoard}=await import('../controllers/allocationController.js');
 const job=await postExhaustedRoleToDeputyBoard({bookingBoardItemId:boardId,bookingRef:'EXAMPLE',roleSlotId:'keyboard-1',fee:400,meta:{role:'Keyboard',MetaISODate:f.board.eventDateISO}},{_id:actId});
 assert.equal(job,null);assert.equal(f.jobs.length,0);
});

test('an exhausted act-deputy chain reopens its paused advert instead of creating a duplicate',async t=>{
 const f=await setup(t);let saved=false;const existing={_id:'555555555555555555555555',status:'closed',workflowStage:'act_deputy_search',save:async()=>{saved=true}};
 t.mock.method(Job,'findOne',async()=>existing);
 const {postExhaustedRoleToDeputyBoard}=await import('../controllers/allocationController.js');
 const job=await postExhaustedRoleToDeputyBoard({bookingBoardItemId:boardId,bookingRef:'EXAMPLE',roleSlotId:'keyboard-1',fee:400,meta:{role:'Keyboard',MetaISODate:f.board.eventDateISO}},{_id:actId});
 assert.equal(job._id,existing._id);assert.equal(job.status,'open');assert.equal(saved,true);assert.equal(f.jobs.length,0);assert.equal(f.board.assignedMusicians[0].deputyJobId,existing._id);assert.notEqual(f.board.allocation.status,'fully_allocated');
});

test('a public-job cancellation pauses the advert, releases the old place and falls back only after the act deputies are exhausted',async t=>{
 const f=await setup(t);const states=[];const job={_id:'555555555555555555555555',status:'filled',workflowStage:'booking_confirmed',allocatedMusicianId:person,bookedMusicianId:person,automation:{roleSlotId:'keyboard-1'},applications:[{musicianId:person,status:'booked'}],roleAllocations:[{musicianId:person,role:'Keyboard',status:'booked'}],save:async()=>{states.push(job.status)}};
 f.jobs.push(job);f.board.assignedMusicians[0].deputyJobId=job._id;t.mock.method(Job,'findById',async()=>job);
 const result=await f.request('/api/allocations');
 assert.equal(result.status,200);assert.deepEqual(states,['closed','open']);assert.equal(job.applications[0].status,'withdrawn');assert.equal(job.roleAllocations[0].status,'cancelled');assert.equal(job.allocatedMusicianId,null);assert.equal(job.bookedMusicianId,null);assert.equal(f.jobs.length,1);
});

test('a paused deputy search is a valid persisted job workflow state',()=>{
 const job=new Job({instrument:'Drums',status:'closed',workflowStage:'act_deputy_search'});
 assert.equal(job.validateSync(),undefined);
});


test('inside seven days an unanswered deputy offer does not prevent the urgent public search',async t=>{
 const f=await setup(t);const date=new Date();date.setUTCDate(date.getUTCDate()+1);f.board.eventDateISO=date.toISOString().slice(0,10);
 t.mock.method(Message,'exists',async()=>({_id:'pending-deputy'}));
 const {postExhaustedRoleToDeputyBoard}=await import('../controllers/allocationController.js');
 const job=await postExhaustedRoleToDeputyBoard({bookingBoardItemId:boardId,bookingRef:'EXAMPLE',roleSlotId:'keyboard-1',fee:400,meta:{role:'Keyboard',MetaISODate:f.board.eventDateISO}},{_id:actId});
 assert.ok(job);assert.equal(f.jobs.length,1);assert.equal(job.status,'open');
});

test('an urgent cancellation reopens its existing public job without pausing for act deputies',async t=>{
 const f=await setup(t),date=new Date();date.setUTCDate(date.getUTCDate()+1);f.board.eventDateISO=date.toISOString().slice(0,10);
 const states=[],job={_id:'555555555555555555555555',status:'filled',workflowStage:'booking_confirmed',allocatedMusicianId:person,bookedMusicianId:person,automation:{roleSlotId:'keyboard-1'},applications:[{musicianId:person,status:'booked'}],roleAllocations:[{musicianId:person,role:'Keyboard',status:'booked'}],save:async()=>{states.push(job.status)}};
 f.jobs.push(job);f.board.assignedMusicians[0].deputyJobId=job._id;t.mock.method(Job,'findById',async()=>job);
 const result=await f.request('/api/allocations');assert.equal(result.status,200);assert.equal(result.data.reallocationRoute,'job_board_reopened');assert.deepEqual(states,['open']);assert.equal(f.jobs.length,1);assert.equal(job.roleAllocations[0].status,'cancelled');assert.equal(job.applications[0].status,'withdrawn');assert.equal(f.board.assignedMusicians[0].status,'posted_to_job_board');
});


test('configured vocal replacements bypass act deputies beyond seven days and preserve approval and role holds',async t=>{
 const f=await setup(t);
 const member={_id:'888888888888888888888888',musicianId:person,instrument:'Lead Male Vocal / Rapper',deputies:[{musicianId:'777777777777777777777777',phone:'+447000000002'}]};
 t.mock.method(Act,'findById',()=>({lean:async()=>({_id:actId,lineups:[{_id:'999999999999999999999999',bandMembers:[member]}]})}));
 t.mock.method(Policy,'findOne',()=>({lean:async()=>({replacementRouting:[{original:{musicianId:person},rolePattern:'Male.*Vocal',route:'job_board'}]})}));
 t.mock.method(Message,'find',()=>{assert.fail('Direct job-board routing must not search the deputy chain')});
 const {escalateToNextDeputy}=await import('../controllers/allocationController.js');
 const msg={actId,bookingBoardItemId:boardId,bookingRef:f.board.bookingRef,roleSlotId:'lead-male-vocal-rapper-1',originalBandMemberId:member._id,musicianId:person,fee:400,meta:{role:member.instrument,MetaISODate:f.board.eventDateISO}};
 assert.deepEqual(await escalateToNextDeputy(msg,{dryRun:true}),{route:'job_board',reason:'role_replacement_policy'});
 f.board.allocation.managerApprovalRequired=true;
 assert.equal(await escalateToNextDeputy(msg,{dryRun:true}),false);
 f.board.allocation.managerApprovalRequired=false;
 f.board.allocationHolds=[{roleSlotId:msg.roleSlotId,active:true}];
 assert.equal(await escalateToNextDeputy(msg,{dryRun:true}),false);
});
