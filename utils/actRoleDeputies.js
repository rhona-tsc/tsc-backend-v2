import {normaliseAllocationRole} from './allocationRoles.js';
import {eligibleRosterDeputies} from './rosterEligibility.js';
export function actRoleDeputies({act,lineup,member,role,policy,board,roleSlotId}) {
 const key=normaliseAllocationRole(role||member?.instrument).toLowerCase();
 const sources=[...(member?[member]:[]),...(act?.lineups||[]).flatMap(l=>l.bandMembers||[]).filter(m=>normaliseAllocationRole(m.instrument||m.role).toLowerCase()===key)];
 const seen=new Set();const out=[];
 for(const source of sources)for(const d of eligibleRosterDeputies({member:source,lineup,policy,address:board?.address||board?.venue,county:board?.county,assignments:board?.assignedMusicians||[],roleSlotId})){
  const identity=String(d.musicianId||'')||String(d.email||'').toLowerCase()||String(d.phoneNumber||d.phone||'').replace(/\D/g,'');
  if(!identity||seen.has(identity))continue;seen.add(identity);out.push(d);
 }
 return out;
}
