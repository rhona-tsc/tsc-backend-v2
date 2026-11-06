import test from 'node:test';
import assert from 'node:assert/strict';
import { automation37SendISO, AUTOMATION_37_TIMING } from '../utils/automation37Schedule.js';
import { finalDetailsDueISO } from '../utils/finalDetailsDueDate.js';
import { prepareAutomation37Rule } from '../utils/automation37Extras.js';

test('Sarah: reminder is 17 December while the Christmas-adjusted deadline is 23 December',()=>{
  const row={eventDateISO:'2026-12-31',bookingDateISO:'2026-11-01'};
  assert.equal(automation37SendISO(row),'2026-12-17');
  assert.equal(finalDetailsDueISO(row),'2026-12-23');
});
test('uses the calendar event week for every weekday, including New Year crossover',()=>{
  for(const date of ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']){
    assert.equal(automation37SendISO({eventDateISO:date}),'2026-12-17',date);
  }
});
test('moves only the reminder itself when its own Thursday is closed',()=>{
  assert.equal(automation37SendISO({eventDateISO:'2027-01-07'}),'2026-12-23');
  assert.equal(automation37SendISO({eventDateISO:'2026-01-08'}),'2025-12-23');
});
test('normal weeks, alternate date fields and missing dates work consistently',()=>{
  assert.equal(automation37SendISO({eventDate:'2026-11-21'}),'2026-11-05');
  assert.equal(automation37SendISO({date:'2026-03-30T00:00:00.000Z'}),'2026-03-19');
  assert.equal(automation37SendISO({}),'');
  assert.equal(automation37SendISO({eventDateISO:'not-a-date'}),'');
});
test('Automation 37 overrides the old 37-day offset and keeps other rule settings',()=>{
  const rule={sourceNumber:37,subject:'Custom',body:'Keep me',enabled:true,status:'reviewed',filters:{agents:['Encore']},timing:{reference:'eventDate',offsetDays:-37,label:'Provisional — review'}};
  const prepared=prepareAutomation37Rule(rule);
  assert.deepEqual(prepared.timing,AUTOMATION_37_TIMING);
  assert.equal(prepared.subject,rule.subject);
  assert.equal(prepared.body,rule.body);
  assert.deepEqual(prepared.filters,rule.filters);
  assert.equal(prepared.enabled,true);
  assert.equal(prepared.status,'reviewed');
  const other={...rule,sourceNumber:38};
  assert.deepEqual(prepareAutomation37Rule(other),other);
});
