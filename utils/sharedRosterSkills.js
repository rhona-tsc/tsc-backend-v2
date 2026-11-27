import { bookingRolePlan, assignmentForSlot, confirmedAllocation } from './bookingAllocationPolicy.js';
import { sameRosterPerson } from './rosterEligibility.js';
const id=p=>String(p?.musicianId||p?._id||p?.id||'');
export const hasSoundEngineering = p => p?.capabilities?.soundEngineering === true ||
  (p?.other_skills || []).some(s=>/sound engineer|audio engineer|front of house|\bfoh\b/i.test(String(s)));

// Shared duties are checked against actual confirmed allocations, never the
// original lineup. An open slot can still supply the skill later.
export function sharedRosterSkillEligibility({board={},lineup,policy,candidate,member,roleSlotId,profiles=[]}={}) {
 const plan=bookingRolePlan(board,lineup);
 const target=plan.find(s=>roleSlotId ? s.roleSlotId===roleSlotId : member && String(s.member?._id)===String(member._id));
 if(!target)return {eligible:true};
 const profileFor=p=>profiles.find(x=>id(x)===id(p))||p;
 for(const rule of policy?.sharedSkillRequirements || []){
  if(rule.skill!=='Sound Engineering')continue;
  let pattern;try{pattern=new RegExp(rule.sourceRolePattern,'i')}catch{continue}
  if(!plan.some(s=>pattern.test(s.role)))continue;
  const other=plan.filter(s=>s!==target).map(s=>assignmentForSlot(board,s,plan));
  const covered=hasSoundEngineering(profileFor(candidate))||other.some(a=>confirmedAllocation(a)&&!sameRosterPerson(a,candidate)&&hasSoundEngineering(profileFor(a)));
  if(covered)continue;
  if(other.some(a=>!confirmedAllocation(a)))return {eligible:true,sharedSkillCoverage:'pending',sharedSkill:'Sound Engineering'};
  return {eligible:false,reason:'Sound engineering is not covered by the other allocated band members. Choose a musician with sound-engineering skills or arrange confirmed sound-engineering cover.',sharedSkillCoverage:'uncovered',sharedSkill:'Sound Engineering'};
 }
 return {eligible:true,sharedSkillCoverage:'covered'};
}
