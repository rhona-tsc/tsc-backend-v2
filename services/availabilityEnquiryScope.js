import mongoose from 'mongoose';
import Availability from '../models/availabilityModel.js';
import EnquiryBoard from '../models/enquiryBoardItem.js';
import BookingBoard from '../models/bookingBoardItem.js';
import Act from '../models/actModel.js';
import { findPriorAvailabilityDecline, availabilityPhone } from './availabilityPriorDeclines.js';

// Shared by reminders and the no-reply handoff. Never correlate by act/date alone.
export async function availabilityEnquiryScopeState(row, { checkRecipient = true, allowContacted = false } = {}) {
  if (!row?.enquiryId || !row.actId || !row.lineupId || !row.dateISO) {
    return { active: false, reason: 'missing-exact-scope' };
  }
  if (checkRecipient && await findPriorAvailabilityDecline({
    dateISO: row.dateISO, musicianId: row.musicianId,
    phone: row.phone, formattedAddress: row.formattedAddress,
  })) return { active: false, reason: 'musician-declined-date-or-location' };
  const references = [{ enquiryRef: row.enquiryId }];
  if (mongoose.isValidObjectId(row.enquiryId)) {
    references.push({ _id: row.enquiryId }, { enquiryId: row.enquiryId });
  }
  const enquiry = await EnquiryBoard.findOne({
    $or: references, actId: row.actId, lineupId: String(row.lineupId),
    eventDateISO: row.dateISO,
  }).select('status').lean();
  if (!enquiry || !['open', 'qualified', ...(allowContacted ? ['contacted'] : [])].includes(enquiry.status)) {
    return { active: false, reason: 'enquiry-not-awaiting-availability' };
  }
  if (await BookingBoard.exists({
    bookingRef: row.enquiryId, actId: row.actId, eventDateISO: row.dateISO,
    bookingStatus: { $ne: 'cancelled' },
  })) return { active: false, reason: 'converted-to-booking' };
  if (await Availability.exists({
    enquiryId: row.enquiryId, actId: row.actId, lineupId: row.lineupId,
    dateISO: row.dateISO, reply: 'yes',
  })) return { active: false, reason: 'lead-already-confirmed-for-enquiry' };
  const act = await Act.findById(row.actId).select('lineups').lean();
  const lineup = act?.lineups?.find(item =>
    [String(item._id), String(item.lineupId)].includes(String(row.lineupId)));
  if (!lineup) return { active: false, reason: 'lineup-not-found' };
  const member = lineup.bandMembers?.find(item =>
    (item.musicianId && String(item.musicianId) === String(row.musicianId)) ||
    (availabilityPhone(item.phoneNumber || item.phone) &&
      availabilityPhone(item.phoneNumber || item.phone) === availabilityPhone(row.phone)));
  if (member?.skipAvailabilityChecks === true) {
    return { active: false, reason: 'musician-outreach-disabled' };
  }
  return { active: true };
}
