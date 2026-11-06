import test from 'node:test';
import assert from 'node:assert/strict';
import { collisionFreeAddOnDay } from '../utils/addOnAutomationDate.js';
const options = {plannedISO:'2026-11-30',introISO:'2026-11-06',deadlineISO:'2026-12-23'};
test('a collision moves to the previous day first, otherwise the next nearest free day',()=>{
  assert.equal(collisionFreeAddOnDay({...options,blockedISOs:[]}), '2026-11-30');
  assert.equal(collisionFreeAddOnDay({...options,blockedISOs:['2026-11-30']}), '2026-11-29');
  assert.equal(collisionFreeAddOnDay({...options,blockedISOs:['2026-11-30','2026-11-29']}), '2026-12-01');
  assert.equal(collisionFreeAddOnDay({...options,blockedISOs:['2026-11-30','2026-11-29','2026-12-01']}), '2026-11-28');
});
test('catch-ups never move backwards or onto another email day',()=>{
  assert.equal(collisionFreeAddOnDay({...options,notBeforeISO:'2026-11-30',blockedISOs:['2026-11-30']}), '2026-12-01');
});
test('the intro day and final deadline cannot be used; an exhausted window stays unscheduled',()=>{
  const short = {...options,introISO:'2026-11-29',deadlineISO:'2026-12-01'};
  assert.equal(collisionFreeAddOnDay({...short,blockedISOs:['2026-11-30']}), '');
  assert.equal(collisionFreeAddOnDay({...options,plannedISO:'2026-11-07',blockedISOs:['2026-11-07']}),'2026-11-08');
  assert.equal(collisionFreeAddOnDay({...options,notBeforeISO:'2026-12-23'}),'');
  assert.equal(collisionFreeAddOnDay({...options,introISO:''}),'');
  assert.equal(collisionFreeAddOnDay({...options,plannedISO:'2026-02-30'}),'');
});
test('calendar-day movement handles month/year boundaries and DST independently of local time',()=>{
  assert.equal(collisionFreeAddOnDay({plannedISO:'2027-01-01',introISO:'2026-12-01',deadlineISO:'2027-01-20',blockedISOs:['2027-01-01']}),'2026-12-31');
  assert.equal(collisionFreeAddOnDay({plannedISO:'2026-10-25',introISO:'2026-10-01',deadlineISO:'2026-11-01',blockedISOs:['2026-10-25']}),'2026-10-24');
});
