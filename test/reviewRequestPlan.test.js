import test from 'node:test';import assert from 'node:assert/strict';
import {reviewPlanSchedule,reviewPlanSendISO,reviewPlanStopReason,renderReviewPlanEmail,exclusiveReviewPlan} from '../utils/reviewRequestPlan.js';
const row={eventDateISO:'2026-12-31',reviewRequestPlan:{enabled:true,exclusive:true,items:[{automationNumber:13,offsetDays:3},{automationNumber:15,offsetDays:10},{automationNumber:3,offsetDays:17,subject:'WE LOVED PERFORMING FOR YOU',body:'Hi {{client_first_name}}, {{act_name}} enjoyed the birthday party.'}]}};
const sent=(number,day)=>({automationNumber:number,status:'sent',sentAt:new Date(`${day}T10:00:00Z`)});
test('the three approved dates are 3, 10 and 17 January',()=>{
 assert.equal(reviewPlanSendISO(row,13),'2027-01-03');assert.equal(reviewPlanSendISO(row,15),'2027-01-10');assert.equal(reviewPlanSendISO(row,3),'2027-01-17');
 assert.equal(reviewPlanSchedule(row,13,'2027-01-02').eligible,false);
 assert.equal(reviewPlanSchedule(row,13,'2027-01-03').eligible,true);
});
test('sequence follows sent history, blocks duplicates and is capped at three requests',()=>{
 const history=[sent(13,'2027-01-03'),sent(15,'2027-01-10')];
 assert.equal(reviewPlanSchedule(row,15,'2027-01-10',history).reason,'already_sent');
 assert.equal(reviewPlanSchedule(row,3,'2027-01-17',history).eligible,true);
 assert.equal(reviewPlanSchedule(row,3,'2027-01-17',[...history,sent(30,'2027-01-12')]).reason,'review_limit_reached');
 assert.equal(reviewPlanSchedule(row,3,'2027-01-17',[]).reason,'awaiting_previous_review_request');
});
test('catch-up never sends a burst and retains seven days between actual sends',()=>{
 const history=[sent(13,'2027-01-17')];
 assert.equal(reviewPlanSchedule(row,15,'2027-01-17',history).eligible,false);
 assert.equal(reviewPlanSchedule(row,15,'2027-01-24',history).eligible,true);
 assert.equal(reviewPlanSchedule(row,3,'2027-01-24',history).eligible,false);
 history.push(sent(15,'2027-01-24'));
 assert.equal(reviewPlanSchedule(row,3,'2027-01-24',history).eligible,false);
 assert.equal(reviewPlanSchedule(row,3,'2027-01-31',history).eligible,true);
 assert.equal(reviewPlanSendISO(row,13,history),'2027-01-17');
});
test('Google review, opt-out, cancellation or disabled website stops remaining requests',()=>{
 for(const change of [{review:{source:'google'}},{review:{googleReceivedAt:new Date()}},{review:{doNotRequest:true}},{bookingStatus:'cancelled'},{siteAutomationsEnabled:false}]){
  const stopped={...row,...change};assert.ok(reviewPlanStopReason(stopped));assert.equal(reviewPlanSchedule(stopped,13,'2027-01-03').eligible,false);
 }
 assert.equal(reviewPlanSchedule({...row,reviewRequestPlan:{...row.reviewRequestPlan,enabled:false}},13,'2027-01-03').eligible,false);
 assert.equal(reviewPlanSchedule({eventDateISO:row.eventDateISO},13,'2027-01-03').reason,'no_review_plan');
});
test('birthday template override and saved central tags resolve without wedding wording',()=>{
 const client={...row,clientFirstNames:'Sarah',eventType:'Birthday Party'};
 const result=renderReviewPlanEmail({sourceNumber:3,subject:'Wedding',body:'Wedding'},client,'Soul Allegiance');
 assert.deepEqual(result,{subject:'WE LOVED PERFORMING FOR YOU',text:'Hi Sarah, Soul Allegiance enjoyed the birthday party.'});
 const thanks=renderReviewPlanEmail({sourceNumber:13,subject:'THANK YOU from {pulse.dropdown}',body:'Hi {pulse.text7}, your {pulse.dup__of_event_type}'},client,'Soul Allegiance');
 assert.match(thanks.text,/Hi Sarah, your Birthday Party/);assert.match(thanks.subject,/Soul Allegiance/);
 assert.throws(()=>renderReviewPlanEmail({sourceNumber:13,subject:'Hello',body:'{pulse.unknown}'},client,'Soul Allegiance'),/unresolved tags/);
 assert.equal(exclusiveReviewPlan(client),true);
});


test('expired sequences do not revive old review requests months later',()=>{
 assert.equal(reviewPlanSchedule(row,13,'2027-04-01').reason,'review_window_closed');
});
