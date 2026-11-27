import test from 'node:test';
import assert from 'node:assert/strict';
import Booking from '../models/bookingModel.js';

test('new bookings opt into the meal schedule without rewriting an imported running order',async()=>{
  const fresh=new Booking({bookingId:'meal-template-test'});
  await fresh.validate();
  assert.equal(fresh.eventSheet.scheduleTemplateVersion,2);
  const savedRows=[{id:'existing',activity:'First set',time:'20:00',notes:'Keep me'}];
  const imported=new Booking({bookingId:'imported-template-test',eventSheet:{answers:{schedule_table_rows:savedRows}}});
  await imported.validate();
  assert.equal(imported.eventSheet.scheduleTemplateVersion,1);
  assert.deepEqual(imported.eventSheet.answers.schedule_table_rows,savedRows);
});

test('saving an existing booking does not upgrade its event sheet',async()=>{
  const existing=Booking.hydrate({bookingId:'legacy-template-test',eventSheet:{answers:{schedule_simple_arrival:'17:00'}}});
  await existing.validate();
  assert.equal(existing.eventSheet.scheduleTemplateVersion,undefined);
  assert.deepEqual(existing.eventSheet.answers,{schedule_simple_arrival:'17:00'});
});
