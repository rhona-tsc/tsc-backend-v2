import Musician from '../models/musicianModel.js';
import { bookingAssignments } from '../utils/bookingAllocationPolicy.js';
import { sharedRosterSkillEligibility } from '../utils/sharedRosterSkills.js';
import Policy from "../models/actRosterPolicy.js";
import { rosterEligibilityForBooking } from "../utils/bookingRosterPools.js";
export const getRosterPolicy = (actId) => Policy.findOne({ actId }).lean();
export async function getBookingSkillProfiles(board={},candidates=[]) {
 const ids=[...new Set([...candidates,...bookingAssignments(board)].map(p=>String(p?.musicianId||p?._id||p?.id||'')))].filter(x=>/^[a-f0-9]{24}$/i.test(x));
 return Musician.find({_id:{$in:ids}}).select('_id capabilities other_skills').lean();
}
export async function bookingRosterEligibility({
  act,
  lineup,
  board,
  candidate,
  member,
  roleSlotId,
  address,
}) {
  const policy = await getRosterPolicy(act._id);
  const eligibility = rosterEligibilityForBooking({
    board,
    policy,
    lineup,
    member,
    candidate,
    roleSlotId,
    assignments: board?.assignedMusicians || [],
    address: address || board?.address || board?.venueAddress || "",
    county: board?.county,
  });
  if(!eligibility.eligible || !policy?.sharedSkillRequirements?.length)return eligibility;
  const profiles=await getBookingSkillProfiles(board||{},[candidate]);
  const shared=sharedRosterSkillEligibility({board,lineup,policy,candidate,member,roleSlotId,profiles});
  return {...eligibility,...shared};
}
