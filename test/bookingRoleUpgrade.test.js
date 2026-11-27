import test from 'node:test';
import assert from 'node:assert/strict';
import { planBookingRoleUpgrade } from '../utils/bookingRoleUpgrade.js';
import { selectRosterMember } from '../utils/rosterEligibility.js';
const rya = { musicianId: 'rya', firstName: 'Rya', lastName: 'Menat' };
const greg = { musicianId: 'greg', firstName: 'Greg', lastName: 'Adams', regions: ['south'], regionalPriority: { south: 1 } };
const frazer = { musicianId: 'frazer', firstName: 'Frazer', lastName: 'Pearce', regions: ['south'], regionalPriority: { south: 2 } };
const bass = { _id: 'bass-new', musicianId: 'ewan', instrument: 'Bass Guitar', fee: 200, deputies: [{ ...rya, regions: ['south'], regionalPriority: { south: 0 } },greg,frazer] };
const mc = { _id: 'mc-new', ...rya, instrument: 'MC/Rapper', fee: 250 };
const singer = { _id: 'singer-new', musicianId: 'kimi', firstName: 'Kimi', instrument: 'Lead Female Vocal' };
const lineup = { bandMembers: [bass, mc, singer] };
const policy = { exclusions: [{ person: rya, withPeople: [rya] }], roleUpgradeTransfers: [{ musicianId: 'rya', fromRole: 'Bass Guitar', toRolePattern: 'vocal|rapper|mc' }] };
const oldBass = { ...rya, role: 'Bass Guitar', originalBandMemberId: 'bass-old', roleSlotId: 'bass-guitar-1', fee: 300, totalFee: 350, status: 'confirmed', offerRequestId: 'old-request' };
const bookedSinger = { musicianId: 'kimi', role: 'Lead Female Vocal', roleSlotId: 'lead-female-vocal-1', originalBandMemberId: 'singer-new', status: 'confirmed' };
const board = { _id: 'board', eventDateISO: '2027-06-01', county: 'London', lineupComposition: ['Bass Guitar','MC/Rapper','Lead Female Vocal'], assignedMusicians: [oldBass,bookedSinger] };
const plan = patch => planBookingRoleUpgrade({ board, lineup, policy, ...patch });

test('upgrade releases Rya from bass, selects him on vocals and selects Greg next', () => {
  const result = plan();
  assert.equal(result.nextBass.musicianId,'greg');
  assert.equal(result.nextBass.status,'selected');
  assert.equal(result.vocal.musicianId,'rya');
  assert.equal(result.vocal.role,'MC/Rapper');
  assert.equal(result.vocal.status,'selected');
  assert.equal(result.vocal.fee,0);
  assert.equal(result.nextBass.fee,0);
  assert.equal(result.offerFee,350);
  assert.equal(result.assignments.filter(a=>a.musicianId==='rya').length,1);
  assert.equal(result.released.offerRequestId,'old-request');
  assert.deepEqual(board.assignedMusicians,[oldBass,bookedSinger]);
});
test('normal role selection respects the upgrade deputy instead of falling back to Ewan', () => {
  const result=plan();
  assert.equal(selectRosterMember({member:bass,lineup,policy,county:'London',assignments:result.assignments}).musicianId,'greg');
});
test('already unavailable deputies are skipped in the agreed order', () => {
  assert.equal(plan({unavailableMusicianIds:['greg']}).nextBass.musicianId,'frazer');
});
test('an exhausted bass pool remains unfilled and never confirms a replacement', () => {
  const result=plan({unavailableMusicianIds:['greg','frazer']});
  assert.equal(result.nextBass.status,'unfilled');
  assert.equal(result.nextBass.musicianId,undefined);
});
test('a completed transfer is idempotent', () => {
  const result=plan();
  assert.equal(plan({board:{...board,assignedMusicians:result.assignments}}),null);
});
test('an existing confirmed Rya vocal assignment is retained with its agreed fee', () => {
  const vocal={...rya,role:'MC/Rapper',roleSlotId:'mc-rapper-1',status:'confirmed',fee:450};
  const result=plan({board:{...board,assignedMusicians:[oldBass,bookedSinger,vocal]}});
  assert.equal(result.vocal.fee,450);
  assert.equal(result.vocalConfirmed,true);
});
test('an allocated replacement vocalist is never displaced by the lineup original', () => {
  const vocal={musicianId:'shamyra',role:'MC/Rapper',roleSlotId:'mc-rapper-1',status:'confirmed'};
  assert.equal(plan({board:{...board,assignedMusicians:[oldBass,bookedSinger,vocal]}}),null);
});
test('no transfer occurs without an explicit act rule or an upgraded vocal slot', () => {
  assert.equal(plan({policy:{}}),null);
  assert.equal(plan({board:{...board,lineupComposition:['Bass Guitar','Lead Female Vocal']}}),null);
});
test('cancelled bookings and inactive bass allocations cannot transfer roles', () => {
  assert.equal(plan({board:{...board,bookingStatus:'cancelled'}}),null);
  for(const status of ['withdrawn','cancelled','declined','replaced'])
    assert.equal(plan({board:{...board,assignedMusicians:[{...oldBass,status},bookedSinger]}}),null);
});
test('a missing event county never mixes regional bass pools', () => {
  const result=plan({board:{...board,county:'',address:''}});
  assert.equal(result.nextBass.status,'unfilled');
});
