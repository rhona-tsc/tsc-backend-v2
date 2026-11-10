import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleDeputyJob } from '../utils/deputyJobVisibility.js';

const job = {
  _id: 'job', title: 'Public role', venue: 'Public venue', fee: 400, jobType: 'booked',
  createdBy: 'owner', createdByEmail: 'owner@example.test', clientEmail: 'client@example.test',
  clientPhone: 'private phone', notes: 'Internal note', stripeCustomerId: 'cus_private',
  defaultPaymentMethodId: 'pm_private', paymentFailureReason: 'Private failure',
  applications: [{ email: 'applicant@example.test' }],
  allocatedMusicianId: { email: 'allocated@example.test' },
  roleRequirements: [{ role: 'Saxophone', quantity: 2 }],
  roleAllocations: [{ role: 'Saxophone', slotNumber: 1, status: 'booked', musicianId: 'player', musicianName: 'Private name' }],
  myApplication: { musicianId: 'player', status: 'applied', notes: 'Internal assessment', email: 'player@example.test' },
};

test('anonymous and unrelated musicians receive only advert fields, never private records', () => {
  for (const user of [undefined, { id: 'stranger', role: 'musician' }]) {
    const result = visibleDeputyJob(job, user);
    assert.equal(result.title, job.title);
    assert.equal(result.venue, job.venue);
    assert.equal(result.isReadyForApplications, true);
    assert.equal(result.postedByLabel, 'A Supreme Collective Member');
    assert.equal(result.myApplication, null);
    assert.deepEqual(result.roleAllocations, [{ role: 'Saxophone', slotNumber: 1, status: 'booked' }]);
    for (const field of ['clientEmail', 'clientPhone', 'notes', 'stripeCustomerId', 'defaultPaymentMethodId', 'applications', 'createdByEmail', 'allocatedMusicianId', 'paymentFailureReason']) {
      assert.equal(Object.hasOwn(result, field), false, field);
    }
  }
});
test('a musician sees their application status without internal notes or other identities', () => {
  const result = visibleDeputyJob(job, { id: 'player', role: 'musician' });
  assert.deepEqual(result.myApplication, { musicianId: 'player', status: 'applied' });
  assert.equal(result.roleAllocations[0].musicianId, 'player');
  assert.equal(result.roleAllocations[0].musicianName, undefined);
});
test('verified owners and staff retain management data; a missing identity never grants access', () => {
  for (const user of [{ id: 'owner' }, { email: 'OWNER@example.test' }, { role: 'admin' }, { role: 'agent' }]) {
    assert.equal(visibleDeputyJob(job, user).clientEmail, job.clientEmail);
  }
  assert.equal(visibleDeputyJob(job, {}).clientEmail, undefined);
  assert.equal(visibleDeputyJob({ ...job, createdBy: { _id: 'owner' } }, { id: 'owner' }).clientEmail, job.clientEmail);
});
