import test from 'node:test';
import assert from 'node:assert/strict';
import { runClientAutomations, buildEventDetailsReminderEmail, eventDetailsReminderSchedule } from '../services/clientAutomationService.js';

const rules = [37,38].map(sourceNumber => ({sourceNumber,enabled:true,subject:'{{event_details_reminder_subject}}',body:'Hi {{client_first_name}},\nEvent Sheet and playlist due {{invoice_due_date}}.\n{{client_event_sheet_link}}\n{{extras_invoice_reminder}}\n{{event_details_completion_reminder}}'}));
test('Encore sequence sends two song reminders and two event-sheet reminders exactly once without chasing the main balance', async () => {
  const keys=['CLIENT_AUTOMATIONS_ENABLED','CLIENT_AUTOMATION_EMAIL_ALLOWLIST','CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST','CLIENT_AUTOMATIONS_NOT_BEFORE'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{CLIENT_AUTOMATIONS_ENABLED:'true',CLIENT_AUTOMATION_EMAIL_ALLOWLIST:'zara@example.test',CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST:'iabQe',CLIENT_AUTOMATIONS_NOT_BEFORE:'2026-01-01'});
  try {
    const row={_id:'zara',bookingRef:'iabQe',clientEmail:'zara@example.test',clientFirstNames:'Zara',eventType:'Birthday Party',agent:'Encore',eventDateISO:'2027-01-16',bookingDateISO:'2026-08-12',songSuggestionsDueDateISO:'2026-12-16',bandEventSheetUrl:'https://example.test/band',actName:'Gotta Be Garage'};
    const records=new Map(); const messages=[];
    const deliveryModel={find:()=>({lean:async()=>[...records.values()].filter(d=>d.status==='sent')}),findOne:async q=>records.get(q.automationKey),create:async d=>{const r={...d,save:async()=>{}};records.set(d.automationKey,r);return r;}};
    const options={bookingModel:{find:()=>({lean:async()=>[row]})},deliveryModel,automationConfigModel:{findOne:()=>({lean:async()=>({rules})})},emailSender:async m=>{messages.push(m);return {ok:true,messageId:'message'};},attachmentBuilder:async()=>{throw Error('Must not attach main invoice');}};
    for(const date of ['2026-12-09','2026-12-16','2026-12-31','2027-01-07','2027-01-07'])await runClientAutomations({...options,now:new Date(date+'T12:00:00Z')});
    assert.deepEqual([...records.values()].map(d=>d.automationNumber),[16,36,37,38]);
    assert.equal(messages.length,4);
    assert.ok(messages.every(m=>!m.attachments));
    assert.ok(messages.every(m=>!/balance|invoice is attached/i.test(m.text)));
    assert.ok(messages.every(m=>!m.subject.includes('Request Request')));
    assert.equal(eventDetailsReminderSchedule(row,37,'2026-12-31').plannedISO,'2026-12-31');
    assert.equal(eventDetailsReminderSchedule(row,38,'2027-01-07').plannedISO,'2027-01-07');
  } finally {for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});
test('event-sheet reminder stops unresolved template tags before sending',()=>{
 assert.throws(()=>buildEventDetailsReminderEmail({eventDateISO:'2027-01-16'},{...rules[0],body:'{{unknown_tag}}'}),/incomplete tags/);
});
