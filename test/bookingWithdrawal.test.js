import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import Board from '../models/bookingBoardItem.js';
import Act from '../models/actModel.js';
import Availability from '../models/availabilityModel.js';
import Message from '../models/EnquiryMessage.js';
import Job from '../models/deputyJobModel.js';
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
 t.mock.method(Message,'findOne',()=>({sort:async()=>null}));
 t.mock.method(Availability,'findOneAndUpdate',async(_filter,update)=>{availability.push(update.$set);return update.$set});
 t.mock.method(Job,'findOne',async()=>jobs[0]||null);
 t.mock.method(Job,'create',async value=>{const job={...value,_id:'555555555555555555555555'};jobs.push(job);return job;});
 const app=express();app.use(express.json());app.use('/api/allocations',allocationRoutes);app.use('/api/booking',bookingRoutes);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,user=person,body={roleSlotId:'keyboard-1',reason:'Out of the country'})=>{
  const r=await fetch(`${url}${path}/bookings/EXAMPLE-BOOKING/withdraw`,{method:'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${jwt.sign({id:user},process.env.JWT_SECRET)}`}:{})},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};
 };
 return{board,availability,jobs,request,url};
}
test('current and cached portal URLs both withdraw only the owned keyboard role and open a deputy job',async t=>{
 for(const prefix of ['/api/allocations','/api/booking']) {
  await t.test(prefix,async t=>{
   const f=await setup(t);const r=await f.request(prefix);
   assert.equal(r.status,200);assert.equal(r.data.success,true);assert.equal(r.data.reallocationRoute,'job_board_created');
   assert.equal(f.availability.length,1);assert.equal(f.availability[0].reply,'unavailable');assert.equal(f.availability[0].status,'unavailable');assert.equal(f.availability[0].dateISO,'2099-12-31');
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
