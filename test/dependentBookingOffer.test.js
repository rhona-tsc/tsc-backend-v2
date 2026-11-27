import test from 'node:test';
import assert from 'node:assert/strict';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_no_external_calls';
const {dependentOfferDecision, createDependentOfferRunner} = await import('../services/dependentBookingOffer.js');
const now = new Date('2026-11-27T14:00:00Z');
const plan = {_id:'plan',state:'waiting',boardId:'board',dateISO:'2027-06-18',requires:[{musicianId:'kedesha',roleSlotId:'vocal-1',offerRequestId:'accepted-offer'}],offer:{musicianId:'mariam',roleSlotId:'rapper-1',fee:415}};
const board = {eventDateISO:plan.dateISO,assignedMusicians:[{musicianId:'kedesha',roleSlotId:'vocal-1',offerRequestId:'accepted-offer',status:'offered'},{musicianId:'mariam',roleSlotId:'rapper-1',status:'proposed'}]};
const accepted = () => ({...board,assignedMusicians:board.assignedMusicians.map(m=>({...m,...(m.musicianId==='kedesha'?{status:'confirmed'}:{})}))});
test('an unanswered offer or availability reply does not trigger the next allocation',()=>{
 assert.equal(dependentOfferDecision(plan,board,now),'waiting');
 assert.equal(dependentOfferDecision(plan,{...board,assignedMusicians:board.assignedMusicians.map(m=>({...m,status:'proposed',reply:'yes'}))},now),'waiting');
});
test('requires the correct person, slot and allocation request to be confirmed',()=>{
 assert.equal(dependentOfferDecision(plan,accepted(),now),'ready');
 const wrong=accepted();wrong.assignedMusicians[0].offerRequestId='other-booking';
 assert.equal(dependentOfferDecision(plan,wrong,now),'waiting');
 const withdrawn=accepted();withdrawn.assignedMusicians[0].withdrawnAt=now;
 assert.equal(dependentOfferDecision(plan,withdrawn,now),'waiting');
});
test('cancelled bookings, changed dates and occupied recipient slots cannot dispatch',()=>{
 assert.equal(dependentOfferDecision(plan,{...accepted(),bookingStatus:'cancelled'},now),'booking-inactive');
 assert.equal(dependentOfferDecision(plan,{...accepted(),eventDateISO:'2027-06-19'},now),'booking-date-changed');
 const changed=accepted();changed.assignedMusicians[1].musicianId='replacement';
 assert.equal(dependentOfferDecision(plan,changed,now),'target-slot-changed');
});
function fixture({fail=false}={}) {
 let item={...plan},sent=null,sends=0,releases=0,restores=0;
 const queue={find:()=>({limit:()=>({toArray:async()=>['waiting','dispatching'].includes(item.state)?[{...item}]:[]})}),updateOne:async(filter,patch)=>{
  if(filter.state&&item.state!==filter.state)return{modifiedCount:0};
  Object.assign(item,patch.$set);return{modifiedCount:1};
 }};
 const runner=createDependentOfferRunner({queue,loadBoard:async()=>accepted(),findOffer:async()=>sent,releaseHold:async()=>{releases++;},restoreHold:async()=>{restores++;},sendOffer:async()=>{sends++;if(fail)throw Error('provider outcome unknown');sent={enquiryId:'new-offer',messageSid:'message'};return{success:true};}});
 return {runner,stats:()=>({item,sends,releases,restores}),set:value=>{item={...item,...value};}};
}
test('sends the authorised dependent offer once and records its request',async()=>{
 const f=fixture();await f.runner({now});await f.runner({now});
 assert.equal(f.stats().sends,1);assert.equal(f.stats().releases,1);
 assert.equal(f.stats().item.requestId,'new-offer');assert.equal(f.stats().item.state,'offered');
});
test('ambiguous failures are held for review and are never resent automatically',async()=>{
 const f=fixture({fail:true});await f.runner({now});await f.runner({now});
 assert.equal(f.stats().sends,1);assert.equal(f.stats().restores,1);assert.equal(f.stats().item.state,'needs_review');
});
test('expired in-flight claims without a recorded send require review',async()=>{
 const f=fixture();f.set({state:'dispatching',leaseUntil:new Date(now.getTime()-1)});await f.runner({now});
 assert.equal(f.stats().sends,0);assert.equal(f.stats().item.state,'needs_review');
});
