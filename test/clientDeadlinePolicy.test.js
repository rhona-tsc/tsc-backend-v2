import test from 'node:test';import assert from 'node:assert/strict';
import {initialClientDeadlineFields,hasUnifiedClientDeadline} from '../utils/clientDeadlinePolicy.js';
import {BALANCE_PAYMENT_POLICY} from '../utils/balanceDueDate.js';
import {finalDetailsDueISO} from '../utils/finalDetailsDueDate.js';
import {buildUnifiedDeadlineEmail,buildAutomation10Email,runClientAutomations} from '../services/clientAutomationService.js';
const row={eventDateISO:'2027-04-23',bookingDateISO:'2026-11-27',agent:'Direct',paymentTermsVersion:BALANCE_PAYMENT_POLICY,clientFirstNames:'Test client'};
test('new bookings have one due date for songs, final details and payment',()=>{
 const result=initialClientDeadlineFields(row);assert.equal(result.clientDeadlineISO,'2027-03-25');assert.equal(result.songSuggestionsDueDateISO,result.clientDeadlineISO);
 assert.equal(finalDetailsDueISO({...row,...result}),result.clientDeadlineISO);assert.equal(hasUnifiedClientDeadline({...row,...result}),true);
 assert.equal(initialClientDeadlineFields({...row,agent:'Encore'}).clientDeadlineISO,undefined);
 assert.deepEqual(initialClientDeadlineFields({...row,introEmailSentAt:'2026-11-01'}),{});
 assert.deepEqual(initialClientDeadlineFields({...row,importMetadata:{introAlreadySent:true}}),{});
});
test('combined reminders retain details requests when paid and use the saved deadline',()=>{
 const fresh={...row,...initialClientDeadlineFields(row)};const email=buildUnifiedDeadlineEmail({...fresh,balancePaid:true},false);
 assert.match(email.text,/balance is recorded as paid/);assert.match(email.text,/song suggestions/i);assert.match(email.text,/25th March 2027/);
 assert.match(buildAutomation10Email(fresh).text,/song suggestions/i);
 assert.equal(finalDetailsDueISO({...fresh,importMetadata:{clientEventSheetDueDateISO:'2027-04-15'}}),'2027-04-15');
});
test('the unified runner sends only two combined reminders and keeps details requests when paid',async()=>{
 const keys=['CLIENT_AUTOMATIONS_ENABLED','CLIENT_AUTOMATION_EMAIL_ALLOWLIST','CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST','CLIENT_AUTOMATIONS_NOT_BEFORE'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.CLIENT_AUTOMATIONS_ENABLED='true';process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST='synthetic-client@example.test';process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST='synthetic-unified';delete process.env.CLIENT_AUTOMATIONS_NOT_BEFORE;
 try{
  const fresh={...row,...initialClientDeadlineFields(row),_id:'synthetic-unified',bookingRef:'synthetic-unified',clientEmail:'synthetic-client@example.test',siteAutomationsEnabled:true,balancePaid:true,invoiceDueDateISO:'2027-03-25',bandEventSheetUrl:'https://example.test/band'};
  const records=[],sent=[];
  const options={bookingModel:{find:()=>({lean:async()=>[fresh]})},deliveryModel:{find:()=>({lean:async()=>records.filter(r=>r.status==='sent')}),findOne:async q=>records.find(r=>r.automationKey===q.automationKey),create:async r=>{const record={...r,save:async()=>{}};records.push(record);return record;}},emailSender:async m=>{sent.push(m);return{ok:true};},attachmentBuilder:async()=>{throw Error('Paid booking must not attach an invoice');},clientLinkBuilder:async r=>({...r,_secureClientEventSheetUrl:'https://thesupremecollective.co.uk/event-sheet/synthetic-unified#upload=synthetic-test-link'})};
  for(const day of ['2027-03-18','2027-03-25','2027-03-26'])await runClientAutomations({...options,now:new Date(day+'T12:00:00Z')});
  assert.deepEqual(records.map(r=>r.automationNumber),[10,11]);assert.equal(sent.length,2);assert.ok(sent.every(m=>/balance is recorded as paid/.test(m.text)&&m.text.includes('#upload=synthetic-test-link')));
 }finally{for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
});
