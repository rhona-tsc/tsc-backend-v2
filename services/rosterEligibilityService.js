import Policy from "../models/actRosterPolicy.js";
import { rosterEligibility } from "../utils/rosterEligibility.js";
export const getRosterPolicy = (actId) => Policy.findOne({ actId }).lean();
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
  return rosterEligibility({
    policy,
    lineup,
    member,
    candidate,
    roleSlotId,
    assignments: board?.assignedMusicians || [],
    address: address || board?.address || board?.venueAddress || "",
    county: board?.county,
  });
}
