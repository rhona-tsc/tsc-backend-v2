import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterEligibility, replacementGoesToJobBoard} from '../utils/rosterEligibility.js';
import {rosterEligibilityForBooking, eligibleDeputiesForBooking, selectRosterMemberForBooking} from '../utils/bookingRosterPools.js';
import {actRoleDeputies} from '../utils/actRoleDeputies.js';
const reese={musicianId:'reese',name:'Reese Robinson'},emma={musicianId:'emma',name:'Emma May'},other={musicianId:'other',name:'Other Singer'};
const member={_id:'female-slot',instrument:'Lead Female Vocal / Rapper',musicianId:'koko',deputies:[reese,emma,other]};
const lineup={bandMembers:[member,{instrument:'Keyboard / Backing Tracks'},{instrument:'Bass Guitar',additionalRoles:[{role:'Backing Vocals'}]}]};
const policy={vocalistLineupRules:[reese,emma].map(person=>({person,allowedVocalistCounts:[2,3]}))};
const context={member,lineup,policy};
test('Reese and Emma require exactly two or three lead vocalists; backing vocals do not count',()=>{
 for(const candidate of [reese,emma]) {
  assert.equal(rosterEligibility({...context,candidate}).eligible,false);
  for(const leadVocalCount of [2,3])assert.equal(rosterEligibility({...context,candidate,leadVocalCount}).eligible,true);
  for(const leadVocalCount of [0,1,4])assert.equal(rosterEligibility({...context,candidate,leadVocalCount}).eligible,false);
 }
 assert.equal(rosterEligibility({...context,candidate:other}).eligible,true);
 assert.equal(rosterEligibility({...context,policy:null,candidate:reese}).eligible,true);
});
test('the booked composition and explicit additional vocalist override the base lineup',()=>{
 const board={lineupComposition:['Lead Female Vocal / Rapper','Lead Male Vocal / Rapper','Keyboard']};
 assert.equal(rosterEligibilityForBooking({...context,board,candidate:emma}).eligible,true);
 assert.deepEqual(eligibleDeputiesForBooking({...context,board:{}}).map(p=>p.musicianId),['other']);
 assert.equal(rosterEligibilityForBooking({...context,board:{extras:[{addsMusician:true,musicianRole:'MC'}]},candidate:emma}).eligible,true);
 assert.equal(rosterEligibilityForBooking({...context,board:{lineupComposition:['Vocals','Keyboard / Backing Vocals']},candidate:emma}).eligible,false);
 const originalReese={...member,...reese};
 assert.equal(selectRosterMemberForBooking({...context,member:originalReese,board:{}}).musicianId,'other');
});
test('cross-variant fallback uses the booked vocal count and does not leak single-vocal restrictions',()=>{
 const act={lineups:[lineup,{bandMembers:[{...member,deputies:[emma,reese]}]}]};
 assert.deepEqual(actRoleDeputies({...context,act,role:member.instrument,board:{}}).map(p=>p.musicianId),['other']);
 assert.deepEqual(actRoleDeputies({...context,act,role:member.instrument,board:{lineupComposition:['Vocals','Rapper']}}).map(p=>p.musicianId),['reese','emma','other']);
});
test('Rya replacements go to job board across variants without affecting his original offer or bass pool',()=>{
 const rya={musicianId:'rya',name:'Rya / Menat',instrument:'Lead Male Vocal / Rapper',deputies:[other]};
 const routing={replacementRouting:[{original:{musicianId:'rya'},rolePattern:'^Lead\\s+Male\\s+Vocal\\s*/\\s*Rapper$',route:'job_board'}]};
 assert.equal(replacementGoesToJobBoard({policy:routing,member:rya}),true);
 assert.deepEqual(actRoleDeputies({act:{lineups:[{bandMembers:[rya]}]},lineup:{bandMembers:[rya]},member:rya,policy:routing}),[]);
 assert.equal(selectRosterMemberForBooking({member:rya,policy:routing,lineup:{bandMembers:[rya]},board:{}}).musicianId,'rya');
 assert.equal(replacementGoesToJobBoard({policy:routing,member:{...rya,instrument:'Bass Guitar'}}),false);
 assert.equal(replacementGoesToJobBoard({policy:routing,member:{...rya,musicianId:'someone-else',name:'Someone Else'}}),false);
});
