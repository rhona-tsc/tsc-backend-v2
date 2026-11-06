import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayReviewPlan, birthdayReviewRule, isBirthdayBooking } from '../utils/birthdayReviewSequence.js';
import { reviewPlanItems, reviewPlanSchedule, reviewPlanSendISO, renderReviewPlanEmail } from '../utils/reviewRequestPlan.js';

const booking = (name = 'Sarah') => ({ clientFirstNames: name, eventType: 'Birthday Party', eventDateISO: '2026-12-31', reviewRequestPlan: birthdayReviewPlan(new Date('2026-11-06T12:00:00Z')) });
test('birthday sequence reuses shared templates and retains the approved dates', () => {
  const row = booking();
  assert.deepEqual(reviewPlanItems(row).map(item => item.automationNumber), [13, 15, 41]);
  assert.deepEqual(reviewPlanItems(row).map(item => reviewPlanSendISO(row, item.automationNumber)), ['2027-01-03', '2027-01-10', '2027-01-17']);
  assert.ok(reviewPlanItems(row).every(item => !item.subject && !item.body));
  assert.equal(birthdayReviewRule().timing.strategy, 'birthday_review_sequence');
});
test('one shared birthday template personalises different clients and acts, including later edits', () => {
  const rule = birthdayReviewRule();
  assert.match(renderReviewPlanEmail(rule, booking(), 'Soul Allegiance').text, /Hi Sarah,[\s\S]*birthday celebrations! Soul Allegiance/);
  assert.match(renderReviewPlanEmail(rule, booking('Alex'), 'Another Band').text, /Hi Alex,[\s\S]*birthday celebrations! Another Band/);
  assert.equal(renderReviewPlanEmail({ ...rule, body: 'Edited for {{client_first_name}} and {{act_name}}' }, booking(), 'Soul Allegiance').text, 'Edited for Sarah and Soul Allegiance');
});
test('birthday template and whole sequence stop for corporate or wedding events', () => {
  for (const eventType of ['Corporate Event', 'Wedding']) {
    const row = { ...booking(), eventType };
    assert.equal(isBirthdayBooking(row), false);
    assert.throws(() => renderReviewPlanEmail(birthdayReviewRule(), row, 'The Band'), /only for birthday/);
    for (const number of [13,15,41]) assert.equal(reviewPlanSchedule(row, number, '2027-01-17').reason, 'birthday_sequence_event_mismatch');
  }
});
test('reusable birthday sequence still stops on Google review and spaces actual sends', () => {
  const row = booking();
  const history = [{automationNumber:13,status:'sent',sentAt:'2027-01-10'}, {automationNumber:15,status:'sent',sentAt:'2027-01-17'}];
  assert.equal(reviewPlanSchedule(row,41,'2027-01-17',history).reason,'not_due');
  assert.equal(reviewPlanSchedule(row,41,'2027-01-24',history).eligible,true);
  assert.equal(reviewPlanSchedule({...row,review:{source:'google'}},41,'2027-01-24',history).reason,'google_review_received');
});
