import test from 'node:test';
import assert from 'node:assert/strict';
import Round from '../models/originalRoundModel.js';
import Event from '../models/originalEventModel.js';
import { removeUnusedOriginalRound } from '../services/originalsRemoveUnusedRoundService.js';
import { originalRoleManagement } from '../services/originalsRoleManagementService.js';
import { advanceOriginalRound } from '../services/originalsRoundProgressionService.js';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { inviteOriginalMusician } from '../controllers/originalsWorkflowController.js';
const owner='111111111111111111111111', projectId='222222222222222222222222', roundId='333333333333333333333333';
const now=new Date('2026-11-20T18:00:00Z');
const initial=()=>({projects:[{_id:projectId,ownerId:owner,__v:1,state:'role_round_open',currentRoundId:roundId,
 requestedRoles:[{name:'Click Track',order:0,recordingOrder:1},{name:'Drums',order:1,recordingOrder:2},{name:'Bass',order:2,recordingOrder:3}]}],
 rounds:[{_id:roundId,projectId,type:'instrument',roleName:'Click Track',state:'open',clockStartedAt:null,sequence:0}],
 assets:[{_id:'guide',projectId,kind:'guide_track',state:'active'}]});
const remove=(extra={})=>removeUnusedOriginalRound({projectId,fromRoundId:roundId,roleName:'Click Track',user:{id:owner},now,...extra});
test('removing an unused current request keeps files/history and allows the owner to choose the next round',async t=>{
 const s=originalsTransactionStore(t,initial());const result=await remove();
 assert.equal(result.removedCurrentRound,true);assert.deepEqual(s.data.projects[0].requestedRoles.map(r=>r.name),['Drums','Bass']);
 assert.equal(s.data.projects[0].state,'owner_review');assert.equal(s.data.projects[0].currentRoundId,roundId);
 assert.equal(s.data.rounds[0].state,'cancelled');assert.equal(s.data.rounds[0].closeReason,'requested_part_removed');
 assert.equal(s.data.assets[0].state,'active');assert.equal(s.data.events[0].type,'project_role_removed');
 const advanced=await advanceOriginalRound({projectId,fromRoundId:roundId,type:'instrument',roleName:'Drums',user:{id:owner},now});
 assert.equal(advanced.round.roleName,'Drums');assert.equal(advanced.round.clockStartedAt,null);assert.equal(s.data.rounds.length,2);
});
test('current rounds with reservations, submissions, invitations or temporary replacement obligations stay protected',async t=>{
 for(const [collection,item] of [
  ['reservations',{roleName:'Click Track',roundId,state:'active',expiresAt:new Date('2030-01-01')}],
  ['reservations',{roleName:'Click Track',roundId,state:'released'}],
  ['submissions',{roleName:'Click Track',roundId,state:'submitted'}],
  ['submissions',{roleName:'Click Track',roundId,state:'accepted'}],
  ['invitations',{roleName:'Click Track',roundId,state:'pending'}],
  ['futures',{roleName:'Click Track',state:'waiting'}],
  ['assets',{kind:'temporary_stem',replacementRoleName:'Click Track',state:'active'}],
 ]) {
  const data=initial();data[collection]=[{_id:'activity',projectId,...item}];const s=originalsTransactionStore(t,data);const before=structuredClone(s.data);
  await assert.rejects(remove(),e=>e.status===409);assert.deepEqual(s.data,before);
 }
});
test('permissions, stale stage, last role, started clocks and final credits are checked again in the transaction',async t=>{
 const s=originalsTransactionStore(t,initial());await assert.rejects(remove({user:{id:'outsider'}}),e=>e.status===403);
 await assert.rejects(remove({fromRoundId:'old'}),/round changed/);
 for(const mutate of [d=>{d.rounds[0].clockStartedAt=now;},d=>{d.projects[0].requestedRoles.length=1;},d=>{d.projects[0].currentCreditVersionId='credits';},d=>{d.projects[0].state='mix_open';}]) {
  const d=initial();mutate(d);const store=originalsTransactionStore(t,d);const before=structuredClone(store.data);
  await assert.rejects(remove(),e=>e.status===409);assert.deepEqual(store.data,before);
 }
});
test('audit/storage failure or a concurrently started round rolls back the complete removal',async t=>{
 let s=originalsTransactionStore(t,initial());let before=structuredClone(s.data);
 t.mock.method(Event,'create',async()=>{throw new Error('Audit unavailable');});await assert.rejects(remove(),/Audit unavailable/);assert.deepEqual(s.data,before);
 s=originalsTransactionStore(t,initial());before=structuredClone(s.data);
 t.mock.method(Round,'updateOne',async()=>({matchedCount:0}));await assert.rejects(remove(),/started this round/);assert.deepEqual(s.data,before);
});
test('repeated removal cannot cancel a second round, and a generic cancelled round cannot bypass review',async t=>{
 const s=originalsTransactionStore(t,initial());const results=await Promise.allSettled([remove(),remove()]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.data.events.length,1);
 s.data.rounds[0].closeReason='some_other_reason';
 await assert.rejects(advanceOriginalRound({projectId,fromRoundId:roundId,type:'instrument',roleName:'Drums',user:{id:owner},now}),/unavailable/);
});
test('the workspace advertises removal only for a genuinely unused current instrument',()=>{
 const data=initial();const snapshot={project:data.projects[0],rounds:data.rounds};
 assert.deepEqual(originalRoleManagement(snapshot,now).roles[0],{name:'Click Track',canRemove:true,removeReason:'',removesCurrentRound:true});
 snapshot.rounds[0].clockStartedAt=now;assert.equal(originalRoleManagement(snapshot,now).roles[0].canRemove,false);
});
test('an invitation racing with round removal is cancelled and cannot queue an email',async t=>{
 const data=initial();const musicianId='444444444444444444444444';data.musicians=[{_id:musicianId,email:'player@gmail.com'}];
 const s=originalsTransactionStore(t,data);
 t.mock.method(Round,'updateOne',async()=>({matchedCount:0}));
 const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await inviteOriginalMusician({params:{roundId},user:{id:owner},body:{musicianId,roleName:'Click Track'}},res);
 assert.equal(res.code,409);assert.equal(s.data.invitations[0].state,'cancelled');assert.equal(s.data.invitations[0].emailPending,false);
 assert.equal(s.data.events.length,0);
});
