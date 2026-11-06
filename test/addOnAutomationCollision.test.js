import test from 'node:test';
import assert from 'node:assert/strict';
import {automation21Schedule,automation14Schedule,automation16Schedule} from '../services/clientAutomationService.js';
import {buildClientAutomationDigest} from '../services/clientAutomationDigestService.js';
const fixture = () => ({agent:'Encore',introEmailSentAt:'2026-11-06T16:12:00.000Z',eventDateISO:'2026-12-31',
  bookingDateISO:'2026-11-01',songSuggestionsDueDateISO:'2026-11-30',invoiceDueDateISO:'2026-12-23'});
test('the add-on email moves off the song deadline without moving the deadline reminder',()=>{
 const row=fixture();
 assert.equal(automation21Schedule(row,'2026-11-06').plannedISO,'2026-11-29');
 assert.equal(automation21Schedule(row,'2026-11-28').eligible,false);
 assert.equal(automation14Schedule(row,'2026-11-30').plannedISO,'2026-11-30');
 assert.equal(automation21Schedule({...row,automationDeliveries:[{status:'sent',automationNumber:16,sentAt:'2026-11-23'}]},'2026-11-29').eligible,true);
});
test('both adjacent days can be occupied, and catch-up uses the next genuinely free day',()=>{
 const row=fixture();
 const schedule=automation21Schedule(row,'2026-11-30');
 assert.equal(schedule.eligible,false);
 assert.equal(schedule.plannedISO,'2026-12-02'); // due-today on 30th, vocalist follow-up on 1st
 assert.equal(automation21Schedule(row,'2026-12-02').sendISO,'2026-12-02');
 assert.equal(automation21Schedule(row,'2026-12-02').reason,'catch_up');
});
test('a missed advance reminder takes priority, but an already-sent reminder does not keep blocking',()=>{
 const row=fixture();
 assert.equal(automation16Schedule(row,'2026-11-29').eligible,true);
 assert.equal(automation21Schedule(row,'2026-11-29').eligible,false);
 row.automationDeliveries=[{automationNumber:16,status:'sent',sentAt:'2026-11-23'}];
 assert.equal(automation21Schedule(row,'2026-11-29').sendISO,'2026-11-29');
 row.automationDeliveries.push({automationNumber:10,status:'sent',sentAt:'2026-11-29'});
 assert.notEqual(automation21Schedule(row,'2026-11-29').sendISO,'2026-11-29');
});
test('no free day inside a very short window means no forced collision or late send',()=>{
 const row={agent:'Encore',introEmailSentAt:'2026-11-29',invoiceDueDateISO:'2026-12-01',songSuggestionsDueDateISO:'2026-11-30'};
 assert.equal(automation21Schedule(row,'2026-11-29').reason,'no_available_date');
 assert.equal(automation21Schedule(fixture(),'2026-12-23').eligible,false);
});
test('the digest displays the same adjusted add-on date as the sender',()=>{
 const row={...fixture(),_id:'example',bookingRef:'UUZfW',clientEmail:'sue_young1576@hotmail.com'};
 const digest=buildClientAutomationDigest({rows:[row],todayISO:'2026-11-06'});
 const addon=digest.bookings[0].automations.find(item=>item.number===21);
 const reminder=digest.bookings[0].automations.find(item=>item.number===14);
 assert.equal(addon.plannedISO,automation21Schedule(row,'2026-11-06').plannedISO);
 assert.equal(addon.plannedISO,'2026-11-29');assert.equal(reminder.plannedISO,'2026-11-30');
 assert.doesNotMatch(addon.status,/SAME-DAY OVERLAP/);
});
