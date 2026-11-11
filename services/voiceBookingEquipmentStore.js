import BookingBoardItem from '../models/bookingBoardItem.js';
import Booking from '../models/bookingModel.js';
import {BOOKING_EQUIPMENT_FIELDS,createBookingEquipmentLookup} from './voiceBookingEquipment.js';
import {readEquipmentProfile} from './voiceEquipmentGoogle.js';
const exact=value=>new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'i');
export async function loadEquipmentBookings({bookingReference,eventDateISO}) {
  const select=query=>query.select(BOOKING_EQUIPMENT_FIELDS).limit(6).maxTimeMS(4000).lean();
  let rows=await select(BookingBoardItem.find({bookingRef:exact(bookingReference),eventDateISO}));
  if(rows.length)return rows;
  const bookings=await Booking.find({bookingId:exact(bookingReference)}).select('_id').limit(2).maxTimeMS(4000).lean();
  if(bookings.length!==1)return [];
  return select(BookingBoardItem.find({eventDateISO,$or:[{bookingId:bookings[0]._id},{sourceBookingId:bookings[0]._id}]}));
}
export const lookupVoiceBookingEquipment=(input,{trustedTestOperator=false}={})=>createBookingEquipmentLookup(input,{trustedTestOperator,loadBookings:loadEquipmentBookings,readEquipmentProfile});
