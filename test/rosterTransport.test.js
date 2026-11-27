import test from 'node:test';import assert from 'node:assert/strict';
import {eligibleRosterDeputies,selectRosterMember} from '../utils/rosterEligibility.js';
const phoebe={_id:'voice',musicianId:'phoebe',firstName:'Phoebe',lastName:'Belli',instrument:'Vocalist-Guitarist'};
const cyrus={_id:'keys',musicianId:'cyrus',firstName:'Cyrus',lastName:'Atkinson',instrument:'Keyboard'};
const deps=[{musicianId:'chris',firstName:'Chris',lastName:'Chambers'},{musicianId:'david',firstName:'David'},{musicianId:'emanuele',firstName:'Emanuele',lastName:'Marchetti'},{musicianId:'kuba',firstName:'Kuba'}];
const member={_id:'drums',musicianId:'connor',instrument:'Drums',deputies:deps};
const lineup={bandMembers:[phoebe,cyrus,member]};
const policy={transportPreference:{preferLondonCarOwners:true,nonDrivers:[{musicianId:'phoebe'},{musicianId:'cyrus'}],londonCarOwners:[{musicianId:'emanuele'}]}};
const names=ps=>ps.map(p=>p.musicianId);
test('confirmed London car owner is prioritised while an original non-driver remains',()=>assert.deepEqual(names(eligibleRosterDeputies({member,lineup,policy})),['emanuele','chris','david','kuba']));
test('agreed order is retained if both non-drivers have actual replacements',()=>{const assignments=[{originalBandMemberId:'voice',musicianId:'mariam',status:'confirmed'},{originalBandMemberId:'keys',musicianId:'sam',status:'confirmed'}];assert.deepEqual(names(eligibleRosterDeputies({member,lineup,policy,assignments})),['chris','david','emanuele','kuba'])});
test('one remaining non-driver still activates the preference',()=>{const assignments=[{originalBandMemberId:'voice',musicianId:'mariam',status:'confirmed'}];assert.equal(eligibleRosterDeputies({member,lineup,policy,assignments})[0].musicianId,'emanuele')});
test('without verified driver evidence the preference does not invent eligibility or reorder',()=>assert.deepEqual(names(eligibleRosterDeputies({member,lineup,policy:{transportPreference:{...policy.transportPreference,londonCarOwners:[]}}})),['chris','david','emanuele','kuba']));
test('transport priority does not bypass regional membership',()=>{const local={...member,deputies:deps.map(d=>({...d,regions:d.musicianId==='emanuele'?['south']:['north']}))};assert.deepEqual(names(eligibleRosterDeputies({member:local,lineup,policy,region:'north'})),['chris','david','kuba'])});
test('transport priority does not bypass an allocation exclusion',()=>{const excluded={...policy,exclusions:[{person:{musicianId:'emanuele'},withPeople:[{musicianId:'phoebe'}]}]};assert.deepEqual(names(eligibleRosterDeputies({member,lineup,policy:excluded})),['chris','david','kuba'])});
test('an available original remains the first selection',()=>assert.equal(selectRosterMember({member,lineup,policy}).musicianId,'connor'));
test('acts without the preference retain their order',()=>assert.deepEqual(names(eligibleRosterDeputies({member,lineup,policy:{}})),['chris','david','emanuele','kuba']));

test('bass transport is not prioritised when the preference is for keys and drums',()=>{const bass={...member,instrument:'Bass Guitar'};const scoped={...policy,transportPreference:{...policy.transportPreference,rolePattern:'^(Keyboard|Drums)$'}};assert.deepEqual(names(eligibleRosterDeputies({member:bass,lineup,policy:scoped})),['chris','david','emanuele','kuba'])});
