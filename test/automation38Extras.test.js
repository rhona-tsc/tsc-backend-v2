import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTOMATION_37_TAGS,prepareEventDetailsReminderRule,renderEventDetailsReminderConditions,eventDetailsExtrasState} from '../utils/automation37Extras.js';
import {finalDetailsDueISO} from '../utils/finalDetailsDueDate.js';
const source={sourceNumber:38,subject:"Automated Reminder: Event Sheet, Spotify Playlist(/s) & 'Extras' Balance Due Today",body:`Keep today's introduction and Event Sheet link.\n\n${AUTOMATION_37_TAGS.payment}\n\n${AUTOMATION_37_TAGS.completion}\n\nKeep Rhona's calendar.`,attachInvoice:true,timing:{strategy:'final_details_due',reference:'eventDate',offsetDays:-14}};
const extras={extras:[{name:'Saxophone',price:640}],extrasInvoicePdfUrl:'https://invoices.example.test/extras.pdf'};
const render=(row,overrides={})=>{const rule=prepareEventDetailsReminderRule({...source,...overrides});return {rule,subject:renderEventDetailsReminderConditions(rule.subject,row,rule),body:renderEventDetailsReminderConditions(rule.body,row,rule)};};
test('38 resolves the copied tags, uses Due Today and attaches the unpaid extras PDF',()=>{
 const result=render(extras);
 assert.equal(result.subject,"Automated Reminder: Event Sheet, Spotify Playlist(/s) & Extras Balance Due Today");
 assert.match(result.body,/the 'extras' balance should also be settled today\. The issued invoice is attached and includes the BACS details\./);
 assert.match(result.body,/paid the 'extras' balance/);
 assert.doesNotMatch(result.body,/\{\{|by this date|Due Soon/);
 assert.equal(eventDetailsExtrasState(extras,result.rule).shouldAttachInvoice,true);
});
test('38 without extras, including a main invoice only, omits all payment wording and attachments',()=>{
 const row={invoicePdfUrl:'https://invoices.example.test/main.pdf'};const result=render(row);
 assert.equal(result.subject,'Automated Reminder: Event Sheet & Spotify Playlist(/s) Due Today');
 assert.match(result.body,/playlist link\(s\), and completed the Event Sheet, please disregard/);
 assert.doesNotMatch(result.body,/balance|attached|BACS|\{\{/i);
 assert.match(result.body,/Keep today's introduction/);assert.match(result.body,/Keep Rhona's calendar/);
 assert.equal(eventDetailsExtrasState(row,result.rule).shouldAttachInvoice,false);
});
test('38 with paid extras uses the simpler subject and completion wording',()=>{
 for(const paid of [{extrasPaid:true},{extrasStatus:'paid'},{payments:{extrasPaymentReceived:true}},{payments:{extrasInvoicePaid:true}}]){
  const row={...extras,...paid};const result=render(row);
  assert.equal(result.subject,'Automated Reminder: Event Sheet & Spotify Playlist(/s) Due Today');
  assert.doesNotMatch(result.body,/balance|attached|BACS/i);
  assert.equal(eventDetailsExtrasState(row,result.rule).shouldAttachInvoice,false);
 }
});
test('38 does not claim an attachment when no extras PDF is issued or attachment is disabled',()=>{
 for(const [row,overrides] of [[{extras:extras.extras},{}],[extras,{attachInvoice:false}]]){
  const result=render(row,overrides);assert.equal(result.subject,"Automated Reminder: Event Sheet, Spotify Playlist(/s) & Extras Balance Due Today");
  assert.match(result.body,/paid the 'extras' balance/);assert.doesNotMatch(result.body,/settled today|attached|BACS/);
  assert.equal(eventDetailsExtrasState(row,result.rule).shouldAttachInvoice,false);
 }
});
test('38 retains the deadline-day timing: Sarah is due on 23 December, distinct from 37',()=>{
 const result=render(extras);assert.deepEqual(result.rule.timing,source.timing);
 assert.equal(finalDetailsDueISO({eventDateISO:'2026-12-31',bookingDateISO:'2026-11-01'}),'2026-12-23');
 const advance=render(extras,{sourceNumber:37,subject:AUTOMATION_37_TAGS.subject});
 assert.match(advance.subject,/Extras Balance Due Soon$/);
 assert.equal(advance.rule.timing.strategy,'final_details_advance');
});
test('38 migration is idempotent and handles old wording without changing unrelated rules',()=>{
 const legacy={...source,subject:'Reminder: Advanced Requests, Event Sheet & Balance Due Today',body:'And finally, the balance should also be settled today.\n\n{pulse.link7}\n\nIf you have already submitted your playlist link(s), completed the Event Sheet, and paid the balance, please disregard this email.'};
 const rule=prepareEventDetailsReminderRule(legacy);
 assert.equal(rule.subject,AUTOMATION_37_TAGS.subject);
 assert.deepEqual(prepareEventDetailsReminderRule(rule),rule);
 assert.doesNotMatch(renderEventDetailsReminderConditions(rule.body,{},rule),/balance|attached|pulse.link7/);
 const other={...source,sourceNumber:36};assert.deepEqual(prepareEventDetailsReminderRule(other),other);
});
