import test from 'node:test';
import assert from 'node:assert/strict';
import {deputyOutcomeRecipients,buildDeputyOutcomeEmail,queueDeputyOutcomeEmails,deliverDeputyOutcomeEmails,completeDeputyAdvertForAssignment} from '../services/deputyOutcomeEmailService.js';
const now=new Date('2026-11-27T17:30:00Z'),winner='111111111111111111111111',other='222222222222222222222222';
const job=()=>({_id:'333333333333333333333333',status:'filled',eventDate:'2026-11-28',instrument:'Drums',venue:'The Beacon',bookedMusicianId:winner,applications:[{musicianId:winner,email:'winner@example.test',status:'booked'},{musicianId:other,email:'other@example.test',firstName:'Other',status:'applied'}]});
function fixture(){
 const rows=new Map(),j=job(),person={_id:other,email:'other@example.test',firstName:'Other'};let sequence=0,allowed=true,sends=0;
 const emails={
  async updateOne(q,u){if(q.eventKey){if(rows.has(q.eventKey))return{upsertedCount:0};rows.set(q.eventKey,{_id:String(++sequence),attempts:0,...u.$setOnInsert});return{upsertedCount:1}}const r=[...rows.values()].find(r=>r._id===q._id&&(!q.status||r.status===q.status));if(r)Object.assign(r,u.$set);return{modifiedCount:r?1:0}},
  async updateMany(){},
  async findOneAndUpdate(){const r=[...rows.values()].find(r=>r.status==='pending'&&r.sendAfter<=now);if(!r)return null;r.status='sending';r.attempts++;r.claimedAt=now;return{...r}},
 };
 const musicians={findById:()=>({select:()=>({lean:async()=>person})})};
 const updates=[],jobs={find:q=>({sort(){return this},limit(){return this},lean:async()=>{assert.ok(q.$or[0].allocatedAt.$gte);assert.ok(q.$expr);return[]}}),findById:()=>({lean:async()=>j}),updateOne:async(q,u)=>{updates.push(u)}};
 const deps={now,emails,musicians,jobs,features:{findOneAndUpdate:async()=>({enabledAt:now})},allowed:async()=>allowed,send:async()=>{sends++;return{ok:true,messageId:'receipt-1'}}};
 return{rows,j,person,deps,updates,setAllowed:v=>allowed=v,sends:()=>sends};
}
test('only unsuccessful active applicants receive updates, excluding selected identities and duplicate email addresses',()=>{
 const j=job();j.applications.push({musicianId:'duplicate',email:'OTHER@example.test',status:'applied'},{musicianId:'withdrawn',email:'withdrawn@example.test',status:'withdrawn'},{musicianId:'declined',email:'declined@example.test',status:'declined'},{musicianId:'alias',email:'winner@example.test',status:'applied'});
 assert.deepEqual(deputyOutcomeRecipients(j).map(a=>a.musicianId),[other]);
 for(const status of ['open','closed','cancelled'])assert.deepEqual(deputyOutcomeRecipients({...j,status}),[]);
 assert.deepEqual(deputyOutcomeRecipients({...j,previewMode:true}),[]);
 assert.equal(deputyOutcomeRecipients({...j,status:'allocated',bookedMusicianId:null,allocatedMusicianId:winner}).length,1);
});
test('the thank-you email escapes content, identifies the gig and offers a separate signed preference link without naming the selected musician',()=>{
 process.env.EMAIL_UNSUBSCRIBE_SECRET='outcome-test-key';
 const mail=buildDeputyOutcomeEmail({job:job(),recipient:{firstName:'<script>bad</script>',to:'other@example.test'}});
 assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);assert.match(mail.text,/Saturday,? 28 November 2026/);assert.match(mail.text,/The Beacon/);assert.match(mail.text,/TSC Assistant/);assert.match(mail.html,/#deputy-filled-updates/);assert.match(mail.text,/keep receiving new deputy opportunities/);assert.doesNotMatch(mail.text,/winner@example/);
});
test('repeated and concurrent queue attempts create one message per applicant and gig',async()=>{
 const f=fixture();await Promise.all([queueDeputyOutcomeEmails({job:f.j,...f.deps}),queueDeputyOutcomeEmails({job:f.j,...f.deps})]);assert.equal(f.rows.size,1);
 await queueDeputyOutcomeEmails({job:f.j,...f.deps});assert.equal(f.rows.size,1);
});
test('opted-out and removed profiles are excluded before queueing',async()=>{
 const f=fixture();f.setAllowed(false);await queueDeputyOutcomeEmails({job:f.j,...f.deps});assert.equal(f.rows.size,0);
 f.setAllowed(true);f.person.profileDeletedAt=now;await queueDeputyOutcomeEmails({job:f.j,...f.deps});assert.equal(f.rows.size,0);
});
test('two worker runs deliver one email, save its receipt, and never scan all historical allocations',async()=>{
 const f=fixture();await queueDeputyOutcomeEmails({job:f.j,...f.deps});await Promise.all([deliverDeputyOutcomeEmails(f.deps),deliverDeputyOutcomeEmails(f.deps)]);
 assert.equal(f.sends(),1);assert.equal([...f.rows.values()][0].status,'sent');assert.equal([...f.rows.values()][0].providerMessageId,'receipt-1');assert.equal(f.updates.filter(u=>u.$push?.notifications).length,1);
 await deliverDeputyOutcomeEmails(f.deps);assert.equal(f.sends(),1);
});
test('opting out after applying, reopening the advert, or choosing that applicant suppresses a queued email',async()=>{
 for(const change of ['optout','reopen','selected']){const f=fixture();await queueDeputyOutcomeEmails({job:f.j,...f.deps});if(change==='optout')f.setAllowed(false);if(change==='reopen')f.j.status='open';if(change==='selected')f.j.bookedMusicianId=other;await deliverDeputyOutcomeEmails(f.deps);assert.equal(f.sends(),0);assert.equal([...f.rows.values()][0].status,'skipped');}
});
test('ambiguous delivery is held for reconciliation and cannot be resent automatically',async()=>{
 const f=fixture();await queueDeputyOutcomeEmails({job:f.j,...f.deps});let sends=0;f.deps.send=async()=>{sends++;return{ok:false,code:'ETIMEDOUT',error:'Unknown after DATA'}};await deliverDeputyOutcomeEmails(f.deps);await deliverDeputyOutcomeEmails(f.deps);assert.equal(sends,1);assert.equal([...f.rows.values()][0].status,'uncertain');
});
test('definitive authentication failures remain queued with backoff rather than being recorded as sent',async()=>{
 const f=fixture();await queueDeputyOutcomeEmails({job:f.j,...f.deps});f.deps.send=async()=>({ok:false,code:'EAUTH',error:'Auth rejected'});await deliverDeputyOutcomeEmails(f.deps);const row=[...f.rows.values()][0];assert.equal(row.status,'pending');assert.equal(+row.sendAfter,+now+15*60000);assert.equal(f.updates.length,0);
});
test('confirming a booking-board replacement closes only its linked advert and records the allocation for the worker',async()=>{
 let write;const jobs={findOneAndUpdate:async(q,u)=>{write={q,u};return{status:'filled'}}};await completeDeputyAdvertForAssignment({board:{_id:'board'},assignment:{deputyJobId:'job',musicianId:other,roleSlotId:'drums-1',status:'confirmed',name:'Other'},jobs,now});assert.equal(write.q['automation.bookingBoardItemId'],'board');assert.equal(write.q['automation.roleSlotId'],'drums-1');assert.equal(write.u.$set.bookedMusicianId,other);assert.equal(write.u.$set.status,'filled');
 write=null;await completeDeputyAdvertForAssignment({board:{_id:'board'},assignment:{status:'offered'},jobs,now});assert.equal(write,null);
});
