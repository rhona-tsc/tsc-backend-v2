import test from 'node:test';import assert from 'node:assert/strict';
import {runClientAutomations,automation26Schedule,automation30Schedule} from '../services/clientAutomationService.js';
const plan={enabled:true,exclusive:true,items:[{automationNumber:13,offsetDays:3},{automationNumber:15,offsetDays:10},{automationNumber:3,offsetDays:17,body:'Hi {{client_first_name}}, {{act_name}} loved the birthday celebrations.'}]};
const rules=[13,15,3].map(sourceNumber=>({sourceNumber,enabled:true,subject:`Review ${sourceNumber} from {pulse.dropdown}`,body:'Hi {pulse.text7}, please review your {pulse.dup__of_event_type}.'}));
const base={_id:'sarah-id',bookingRef:'UUZfW',clientEmail:'sue_young1576@hotmail.com',clientFirstNames:'Sarah',agent:'Encore',actName:'Soul Allegiance',eventType:'Birthday Party',eventDateISO:'2026-12-31',bookingDateISO:'2026-11-01',reviewRequestPlan:plan};
function fixture(){
 const records=new Map(),sent=[];let rows=[structuredClone(base)];
 const bookingModel={find:()=>({lean:async()=>rows})};
 const deliveryModel={find:({bookingId})=>({lean:async()=>[...records.values()].filter(r=>r.bookingId===bookingId&&r.status==='sent')}),findOne:async({automationKey,bookingId})=>records.get(`${automationKey}|${bookingId}`)||null,create:async(value)=>{const record={...value,save:async()=>{}};records.set(`${value.automationKey}|${value.bookingId}`,record);return record;}};
 let activeDay='';const options={bookingModel,deliveryModel,automationConfigModel:{findOne:()=>({lean:async()=>({rules})})},emailSender:async message=>{sent.push(message);return {ok:true,messageId:`test-${sent.length}`};},actProfileModel:{findOne:()=>({lean:async()=>null})}};
 return {records,sent,rows,options,run:async day=>{activeDay=day;const result=await runClientAutomations({...options,now:new Date(`${day}T10:05:00Z`)});for(const record of records.values())if(record.status==='sent'&&!record.testDated){record.sentAt=new Date(`${activeDay}T10:05:00Z`);record.testDated=true;}return result;}};
}
const enable=t=>{const previous=process.env.CLIENT_AUTOMATIONS_ENABLED;process.env.CLIENT_AUTOMATIONS_ENABLED='true';t.after(()=>{if(previous===undefined)delete process.env.CLIENT_AUTOMATIONS_ENABLED;else process.env.CLIENT_AUTOMATIONS_ENABLED=previous;});};
test('staged sender delivers Sarah’s three emails once, on the approved dates, without invoices',async t=>{
 enable(t);const f=fixture();for(const day of ['2027-01-02','2027-01-03','2027-01-03','2027-01-09','2027-01-10','2027-01-10','2027-01-16','2027-01-17','2027-01-24'])await f.run(day);
 assert.equal(f.sent.length,3);assert.deepEqual(f.sent.map(m=>m.subject),['Review 13 from Soul Allegiance','Review 15 from Soul Allegiance','Review 3 from Soul Allegiance']);
 assert.ok(f.sent.every(m=>m.to===base.clientEmail&&!m.attachments));assert.match(f.sent[2].text,/birthday celebrations/);
 assert.equal([...f.records.values()].filter(r=>r.status==='sent').length,3);
});
test('no planned review email is sent after a Google review, opt-out, or plan disable',async t=>{
 enable(t);for(const change of [{review:{source:'google'}},{review:{googleReceivedAt:new Date()}},{review:{doNotRequest:true}},{reviewRequestPlan:{...plan,enabled:false}}]){const f=fixture();Object.assign(f.rows[0],change);await f.run('2027-01-03');assert.equal(f.sent.length,0);}
});
test('late startup sends one catch-up, then spaces the next two by at least seven days',async t=>{
 enable(t);const f=fixture();for(const day of ['2027-01-17','2027-01-17','2027-01-18','2027-01-23'])await f.run(day);assert.equal(f.sent.length,1);
 await f.run('2027-01-24');assert.equal(f.sent.length,2);await f.run('2027-01-30');assert.equal(f.sent.length,2);await f.run('2027-01-31');assert.equal(f.sent.length,3);
});
test('exclusive sequence excludes additional review-conversion emails',()=>{
 const row={...base,review:{source:'other',comment:'A review',nonGoogleReceivedAt:'2027-01-04'}};
 assert.equal(automation30Schedule(row,'2027-01-04').reason,'booking_review_plan');assert.equal(automation26Schedule(row,'2027-01-09',{status:'sent',sentAt:'2027-01-04'}).reason,'booking_review_plan');
});
test('bookings without a plan are not opted into the new review sender',async t=>{
 enable(t);const f=fixture();delete f.rows[0].reviewRequestPlan;await f.run('2027-01-03');assert.equal(f.sent.length,0);
});


test('a failed delivery can retry without sending later requests or duplicate successful emails',async t=>{
 enable(t);const f=fixture();let reject=true;
 f.options.emailSender=async message=>{if(reject)return {ok:false,error:'Temporary provider failure'};f.sent.push(message);return {ok:true,messageId:'retry-success'};};
 const failed=await f.run('2027-01-03');assert.equal(failed.failed,1);assert.equal(f.sent.length,0);
 reject=false;await f.run('2027-01-03');assert.equal(f.sent.length,1);await f.run('2027-01-03');assert.equal(f.sent.length,1);
 assert.equal([...f.records.values()][0].attempts,2);
});

test('global sender switch and rule switches are respected for the saved sequence',async t=>{
 enable(t);const f=fixture();process.env.CLIENT_AUTOMATIONS_ENABLED='false';const off=await f.run('2027-01-03');assert.equal(off.enabled,false);assert.equal(f.sent.length,0);
 process.env.CLIENT_AUTOMATIONS_ENABLED='true';f.options.automationConfigModel={findOne:()=>({lean:async()=>({rules:rules.map(rule=>({...rule,enabled:false}))})})};await f.run('2027-01-03');assert.equal(f.sent.length,0);
});

test('the new birthday template sends from the saved central rule, without enrolling corporate bookings',async t=>{
 enable(t);const f=fixture();
 f.rows[0].reviewRequestPlan.items[2]={automationNumber:41,offsetDays:17};
 f.options.automationConfigModel={findOne:()=>({lean:async()=>({rules:[...rules,{sourceNumber:41,enabled:true,subject:'Birthday review for {{act_name}}',body:'Hi {{client_first_name}}, lovely birthday memories!'}]})})};
 for(const day of ['2027-01-03','2027-01-10','2027-01-17']) await f.run(day);
 assert.equal(f.sent.length,3);assert.equal(f.sent[2].subject,'Birthday review for Soul Allegiance');
 const corporate=fixture();corporate.rows[0].eventType='Corporate Event';corporate.rows[0].reviewRequestPlan.items[2]={automationNumber:41,offsetDays:17};
 corporate.options.automationConfigModel=f.options.automationConfigModel;
 await corporate.run('2027-01-03');assert.equal(corporate.sent.length,0);
});
