import test from 'node:test';import assert from 'node:assert/strict';import Musician from '../models/musicianModel.js';import {resolveAssignedMusiciansFromBooking} from '../controllers/bookingController.js';
test('blank imported allocation phones fall back to the saved musician contact',async()=>{const find=Musician.find;Musician.find=()=>({select:()=>({lean:async()=>[{_id:'6ac8e16b884d0ae986191b1f',firstName:'Greg',lastName:'Adams',phone:'+447700900123'}]})});try{const m=await resolveAssignedMusiciansFromBooking({assignedMusicians:[{musicianId:'6ac8e16b884d0ae986191b1f',name:'Greg Adams',phone:''}]});assert.equal(m[0].phone,'+447700900123');}finally{Musician.find=find;}});

import Booking from '../models/bookingModel.js';
import BookingBoardItem from '../models/bookingBoardItem.js';
import {ensureEmergencyContact} from '../controllers/bookingController.js';
test('clears previous forwarding contacts when no musicians remain confirmed on the board', async () => {
 const original = {find:Booking.findOne, board:BookingBoardItem.findOne, update:Booking.findByIdAndUpdate};
 const book = {_id:'6ac7c0a494a7eb6862938cc4',bookingId:'TEST',contactRouting:{proxyNumber:'+447882963384',ivrCode:'12345',targets:[{name:'Removed player'}]},eventSheet:{}};
 Booking.findOne=async()=>book;
 BookingBoardItem.findOne=()=>({lean:async()=>({assignedMusicians:[]})});
 let saved;
 Booking.findByIdAndUpdate=async(id,patch)=>{saved=patch.$set;};
 let result;
 try {
  await ensureEmergencyContact({params:{id:'TEST'}},{json:value=>{result=value;},status:()=>{throw new Error('Unexpected error');}});
  assert.equal(result.success,true);
  assert.deepEqual(saved.contactRouting.targets,[]);
  assert.equal(saved.contactRouting.ivrCode,'12345');
 } finally {Booking.findOne=original.find;BookingBoardItem.findOne=original.board;Booking.findByIdAndUpdate=original.update;}
});
