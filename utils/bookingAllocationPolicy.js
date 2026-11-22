import {normaliseAllocationRole,allocationMatchesRoleSlot} from './allocationRoles.js';
import {effectiveLineupRoles} from './bookingLineupAdditions.js';
export const londonDay = (now=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const daysUntilBooking=(date,now=new Date()) => Math.round((Date.parse(`${String(date).slice(0,10)}T00:00:00Z`)-Date.parse(`${londonDay(now)}T00:00:00Z`))/86400000);
export const withinAllocationWeek=(date,now=new Date()) => {const days=daysUntilBooking(date,now);return days>=0&&days<=7;};
const slotKey=value=>{const m=String(value||'').match(/^(.*)-(\d+)$/);return m?`${normaliseAllocationRole(m[1].replace(/-/g,' ')).toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${m[2]}`:String(value||'');};
export const activeAllocationHold=(board,slot,now=new Date()) => (board?.allocationHolds||[]).find(h=>h.active&&slotKey(h.roleSlotId)===slotKey(slot)&&(!h.until||new Date(h.until)>now));
export const activeBooking=board=> !board?.trashedAt&&!board?.deletedAt&&!board?.cancellation?.cancelledAt&&![board?.bookingStatus,board?.status].some(value=>['cancelled','closed_lost','deleted'].includes(String(value||'').toLowerCase()));
export function rolesFromBookingLabel(label='') {
 const text=String(label).match(/\(([^)]+)\)/)?.[1]||String(label).split(':')[1]||'';
 return text.replace(/,?\s*with up to.*$/i,'').split(/,|\s+and\s+|\s*&\s*/).flatMap(raw=>{
  const value=raw.trim();if(!value)return[];
  const m=value.match(/^(\d+)\s*x\s*(.+)$/i);return Array(Math.min(20,Number(m?.[1]||1))).fill(m?.[2]||value);
 });
}
export function bookingRolePlan(board,lineup) {
 let roles=board.lineupComposition?.length?board.lineupComposition:rolesFromBookingLabel(board.lineupSelected||board.actsSummary?.[0]?.lineupLabel);
 if(!roles.length&&lineup)roles=(lineup.bandMembers||[]).map(m=>m.instrument||m.role);
 const count=new Map();
 return effectiveLineupRoles(board,roles).map(normaliseAllocationRole).filter(r=>r&&!/^(manager|admin)$/i.test(r)).map(role=>{
  const n=(count.get(role)||0)+1;count.set(role,n);
  const members=(lineup?.bandMembers||[]).filter(m=>normaliseAllocationRole(m.instrument||m.role)===role);
  return{role,roleSlotId:`${role.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${n}`,member:members[n-1]};
 });
}
export function bookingAssignments(board) {
 const all=[...(board.assignedMusicians||[]),...(board.bookingMusicians||[]),...(board.bandLineup||[]),...(board.bookingDetails?.assignedMusicians||[])];
 const seen=new Set();return all.filter(a=>{const key=a.roleSlotId||`${a.musicianId||a.email||a.name}:${a.role||a.instrument}`;if(seen.has(key))return false;seen.add(key);return true;});
}
export function assignmentForSlot(board,slot,plan=[]) {
 const all=bookingAssignments(board);const exact=all.find(a=>a.roleSlotId===slot.roleSlotId);if(exact)return exact;
 const same=all.filter(a=>allocationMatchesRoleSlot(a,slot));
 if(same.length)return same[0];
 // Old imported "Vocals" allocations only resolve a single vocalist role.
 if(/vocal/i.test(slot.role)&&plan.filter(s=>/vocal/i.test(s.role)).length===1)return all.find(a=>!a.roleSlotId&&/^(vocals?|vocalist)$/i.test(a.role||a.instrument));
 return null;
}
export const confirmedAllocation=a=>Boolean(a&&!a.withdrawnAt&&['confirmed','accepted'].includes(String(a.status).toLowerCase()));
