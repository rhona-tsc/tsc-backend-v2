import {normaliseAllocationRole} from './allocationRoles.js';
import {eligibleRosterDeputies,replacementGoesToJobBoard} from './rosterEligibility.js';
import {bookingPoolRegions,bookingLeadVocalCount} from './bookingRosterPools.js';
export function actRoleDeputies({act,lineup,member,role,policy,board,roleSlotId}) {
 if(replacementGoesToJobBoard({policy,member,role}))return [];
 const key=normaliseAllocationRole(role||member?.instrument).toLowerCase();
 const sources=[...(member?[member]:[]),...(act?.lineups||[]).flatMap(l=>l.bandMembers||[]).filter(m=>normaliseAllocationRole(m.instrument||m.role).toLowerCase()===key)];
 const seen=new Set();const out=[];
 const regions=bookingPoolRegions(board,roleSlotId);
 for(const region of regions.length?regions:[undefined])for(const source of sources)for(const d of eligibleRosterDeputies({member:source,lineup,policy,leadVocalCount:bookingLeadVocalCount(board,lineup),address:board?.address||board?.venue,county:board?.county,assignments:board?.assignedMusicians||[],roleSlotId,...(region?{region}:{})})){
  const identity=String(d.musicianId||'')||String(d.email||'').toLowerCase()||String(d.phoneNumber||d.phone||'').replace(/\D/g,'');
  if(!identity||seen.has(identity))continue;seen.add(identity);out.push(d);
 }
 return out;
}
