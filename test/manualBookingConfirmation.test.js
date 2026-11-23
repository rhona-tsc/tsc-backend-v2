import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedBookingAvailabilityWrite, syncConfirmedBookingAssignments} from '../services/manualBookingConfirmation.js';
import {availabilityEnquiryIndexKey} from '../services/availabilityRequestIdentity.js';

const board = {bookingRef:'BBM 499 BREWERS',eventDateISO:'2026-12-31',address:'Chigwell'};
const write = (id, booking = board) => confirmedBookingAvailabilityWrite({
  board:booking, candidate:{musicianId:id,name:id,role:'Drums',respondedAt:new Date()},
  contact:{phone:'',email:`${id}@example.test`}, eventId:'calendar-event',
});
const uniqueKey = spec => JSON.stringify(Object.keys(availabilityEnquiryIndexKey).map(key =>
  ({...spec.update.$setOnInsert,...spec.update.$set})[key] ?? null));

test('two email-only musicians can be confirmed under the real availability unique index', () => {
  assert.notEqual(uniqueKey(write('greg')),uniqueKey(write('david')));
  assert.notEqual(uniqueKey(write('david')),uniqueKey(write('david',{...board,bookingRef:'OTHER'})));
  assert.equal(uniqueKey(write('david')),uniqueKey(write('david')));
});
test('confirmation cannot relabel a different booking through a blank/shared phone', () => {
  const {filter,update}=write('david');
  assert.deepEqual(filter,{musicianId:'david',bookingId:board.bookingRef,dateISO:board.eventDateISO});
  assert.equal(update.$set.status,'accepted');
  assert.equal(update.$set.calendarEventId,'calendar-event');
});
test('accepted board allocations replace every core mirror without overwriting event or payment data',async()=>{
  const members=[{musicianId:'greg',status:'confirmed',fee:500},{musicianId:'david',status:'confirmed',fee:410}];
  const core={_id:'core',assignedMusicians:[{musicianId:'david',status:'offered'}],eventSheet:{token:'kept'},paymentStatus:'unpaid'};
  let saved;
  await syncConfirmedBookingAssignments({board:{...board,assignedMusicians:members,allocation:{status:'in_progress'}},booking:core,
    BookingModel:{collection:{updateOne:async(filter,update)=>{assert.deepEqual(filter,{_id:'core'});saved=update.$set;}}}});
  for(const field of ['assignedMusicians','bookingMusicians','bandLineup','bookingDetails.assignedMusicians'])assert.deepEqual(saved[field],members);
  assert.equal(saved.eventSheet,undefined);assert.equal(saved.paymentStatus,undefined);
});
