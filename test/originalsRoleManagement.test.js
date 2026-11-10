import test from 'node:test';
import assert from 'node:assert/strict';
import Project from '../models/originalProjectModel.js';
import Asset from '../models/originalAssetModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Future from '../models/originalRoleReservationModel.js';
import Event from '../models/originalEventModel.js';
import { originalRoleManagement, originalRoleName } from '../services/originalsRoleManagementService.js';
import { changeOriginalProjectRole } from '../controllers/originalsRolesController.js';
import { reopenOriginalRound } from '../controllers/originalsWorkflowController.js';
import { presentOriginalWorkspace } from '../services/originalsAccessService.js';

const owner='111111111111111111111111', player='222222222222222222222222', projectId='333333333333333333333333';
const now=new Date('2026-11-04T22:00:00Z');
const base=()=>({ project:{_id:projectId,ownerId:owner,__v:2,state:'foundation_open',currentRoundId:'round',requestedRoles:[{name:'Vocal',order:0,foundationEligible:true},{name:'Bass',order:1,foundationEligible:false}]}, rounds:[{_id:'round',type:'foundation',eligibleRoles:['Vocal'],state:'open'}], reservations:[], submissions:[], invitations:[],futureReservations:[], assets:[],notifications:[],creditVersions:[],issues:[],messages:[] });
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function setup(t,snapshot=base()) {
 t.mock.method(Asset,'exists',async query=>snapshot.assets.some(asset=>asset.kind==='temporary_stem'&&asset.state==='active'&&asset.replacementRoleName===query.replacementRoleName));
 const writes=[],events=[];
 t.mock.method(Project,'findById',()=>({lean:async()=>snapshot.project}));
 for(const [Model,key]of[[Round,'rounds'],[Reservation,'reservations'],[Submission,'submissions'],[Invitation,'invitations'],[Future,'futureReservations']]) t.mock.method(Model,'find',()=>({select:()=>({lean:async()=>snapshot[key]})}));
 t.mock.method(Project,'findOneAndUpdate',(query,update)=>({lean:async()=>{writes.push({query,update});return{...snapshot.project,...update.$set};}}));
 t.mock.method(Event,'create',async data=>{events.push(data);return data;});
 return{snapshot,writes,events};
}
const request=(body,user={id:owner})=>({params:{id:projectId},body,user});

test('custom future role is added without changing the current round, reservations or accepted credits',async t=>{
 const{writes,events}=setup(t);const res=response();await changeOriginalProjectRole(request({action:'add',roleName:'  Click   track  '}),res);
 assert.equal(res.code,200);assert.deepEqual(res.body.requestedRoles.at(-1),{name:'Click track',order:2,foundationEligible:false});
 assert.equal(writes[0].query.__v,2);assert.equal(writes[0].query.currentRoundId,'round');assert.equal(writes[0].update.$inc.__v,1);
 assert.deepEqual(Object.keys(writes[0].update.$set),['requestedRoles']);assert.equal(events[0].type,'project_role_added');assert.equal(events[0].actorId,owner);
});
test('removal affects only the plan, keeps history, and reindexes the remaining parts',async t=>{
 const snapshot=base();snapshot.reservations=[{_id:'old-booking',roleName:'Bass',state:'expired'}];snapshot.submissions=[{reservationId:'old-booking',roleName:'Bass',state:'rejected'}];
 const{writes,events}=setup(t,snapshot);const res=response();await changeOriginalProjectRole(request({action:'remove',roleName:'bass'}),res);
 assert.equal(res.code,200);assert.deepEqual(res.body.requestedRoles,[{name:'Vocal',order:0,foundationEligible:true}]);assert.equal(snapshot.reservations.length,1);assert.equal(snapshot.submissions.length,1);assert.equal(events[0].metadata.roleName,'Bass');assert.equal(writes.length,1);
});
test('only the owner or an authorised TSC manager can edit parts',async t=>{
 const{writes}=setup(t);const denied=response();await changeOriginalProjectRole(request({action:'remove',roleName:'Bass'},{id:player}),denied);assert.equal(denied.code,403);assert.equal(writes.length,0);
 const allowed=response();await changeOriginalProjectRole(request({action:'add',roleName:'Strings'},{id:player,role:'admin'}),allowed);assert.equal(allowed.code,200);
});
test('duplicate names, malformed inputs, production names and the 30-part limit are rejected',async t=>{
 const{snapshot,writes}=setup(t);
 for(const name of['vOcAl',' Vocal ']){const res=response();await changeOriginalProjectRole(request({action:'add',roleName:name}),res);assert.equal(res.code,409);}
 for(const roleName of['',{},['Drums'],'a'.repeat(81),'Bass\nGuitar','Mix producer','Mastering engineer']){const res=response();await changeOriginalProjectRole(request({action:'add',roleName}),res);assert.equal(res.code,400);}
 assert.equal(originalRoleName('  Bass   clarinet '),'Bass clarinet');
 snapshot.project.requestedRoles=Array.from({length:30},(_,i)=>({name:`Part ${i}`,order:i}));const res=response();await changeOriginalProjectRole(request({action:'add',roleName:'Percussion'}),res);assert.equal(res.code,409);assert.equal(writes.length,0);
});
test('submitted, accepted and disputed material, current rounds and held places block removal',()=>{
 for(const state of['submitted','accepted','retraction_requested']){const s=base();s.submissions=[{roleName:'bASS',state}];const rule=originalRoleManagement(s,now).roles[1];assert.equal(rule.canRemove,false);assert.match(rule.removeReason,/recording/);}
 for(const state of['active','submitted']){const s=base();s.reservations=[{roleName:'Bass',state,expiresAt:'2030-01-01'}];assert.equal(originalRoleManagement(s,now).roles[1].canRemove,false);}
 const s=base();s.futureReservations=[{roleName:'Bass',state:'waiting'}];assert.match(originalRoleManagement(s,now).roles[1].removeReason,/advance/);
 s.futureReservations[0].state='released';assert.equal(originalRoleManagement(s,now).roles[1].canRemove,true);
 assert.match(originalRoleManagement(s,now).roles[0].removeReason,/current round/);
});
test('last role, last draft foundation and credit or production stages are protected',()=>{
 const s=base();s.project.state='draft';s.project.currentRoundId=null;s.rounds=[];s.project.sourceType='none';assert.match(originalRoleManagement(s,now).roles[0].removeReason,/foundation/);
 s.project.requestedRoles=s.project.requestedRoles.slice(0,1);assert.match(originalRoleManagement(s,now).roles[0].removeReason,/at least one/);
 for(const state of['pending_moderation','mix_open','master_open','credits_confirmation','approved_master','cancelled']){s.project.state=state;assert.equal(originalRoleManagement(s,now).canEdit,false);}
 s.project.state='owner_review';s.project.currentCreditVersionId='credits';assert.equal(originalRoleManagement(s,now).canEdit,false);
});
test('server rechecks removal guards rather than trusting the owner page',async t=>{
 const s=base();s.futureReservations=[{roleName:'Bass',state:'waiting'}];const{writes}=setup(t,s);const res=response();await changeOriginalProjectRole(request({action:'remove',roleName:'Bass',canRemove:true}),res);assert.equal(res.code,409);assert.equal(writes.length,0);
});
test('stale project comparisons never overwrite another edit or stage',async t=>{
 const{events}=setup(t);t.mock.method(Project,'findOneAndUpdate',()=>({lean:async()=>null}));const res=response();await changeOriginalProjectRole(request({action:'add',roleName:'Brass'}),res);assert.equal(res.code,409);assert.match(res.body.message,/Refresh/);assert.equal(events.length,0);
});
test('workspace exposes part-edit controls only to managers',()=>{
 const s=base();const manager=presentOriginalWorkspace(s,{id:owner}),participant=presentOriginalWorkspace(s,{id:player});
 assert.equal(manager.roleManagement.canEdit,true);assert.equal(manager.roleProgress[0].canRemove,false);assert.equal(manager.roleProgress[1].canRemove,true);
 assert.equal(participant.roleManagement,undefined);assert.equal(participant.roleProgress[1].canRemove,undefined);
});
test('a historical round cannot be reopened to bring a removed part back implicitly',async t=>{
 const s=base();setup(t,s);let saved=false;t.mock.method(Round,'findById',async()=>({_id:'old',projectId,type:'instrument',roleName:'Strings',state:'closed',save:async()=>{saved=true;}}));
 const res=response();await reopenOriginalRound({params:{roundId:'old'},user:{id:owner},body:{}},res);assert.equal(res.code,409);assert.equal(saved,false);assert.match(res.body.message,/removed/);
});

test('owner or TSC can save a partial recording plan without changing the live round; add/remove preserve it', async t => {
 const {snapshot,writes,events}=setup(t);snapshot.project.requestedRoles[0].recordingOrder=2;
 const res=response();await changeOriginalProjectRole(request({action:'set_order',recordingOrder:[{name:'Vocal',recordingOrder:2},{name:'Bass',recordingOrder:1}]}),res);
 assert.equal(res.code,200);assert.equal(res.body.requestedRoles[1].recordingOrder,1);assert.equal(writes[0].query.currentRoundId,'round');assert.equal(events[0].type,'project_recording_order_updated');
 const add=response();await changeOriginalProjectRole(request({action:'add',roleName:'Keys'}),add);assert.equal(add.body.requestedRoles[0].recordingOrder,2);
 const remove=response();await changeOriginalProjectRole(request({action:'remove',roleName:'Bass'}),remove);assert.equal(remove.body.requestedRoles[0].recordingOrder,2);
 const clear=response();await changeOriginalProjectRole(request({action:'set_order',recordingOrder:[{name:'Vocal',recordingOrder:''},{name:'Bass',recordingOrder:null}]}),clear);assert.equal(clear.body.requestedRoles[0].recordingOrder,null);
});
test('invalid, duplicated, missing or stale recording plans cannot alter the saved plan', async t => {
 const {writes}=setup(t);
 for(const recordingOrder of [[{name:'Vocal',recordingOrder:1},{name:'Bass',recordingOrder:1}],[{name:'Vocal',recordingOrder:-1},{name:'Bass'}]]){
  const res=response();await changeOriginalProjectRole(request({action:'set_order',recordingOrder}),res);assert.equal(res.code,400);
 }
 for(const recordingOrder of [null,[{name:'Vocal'}],[{name:'Bass'},{name:' bass '}],[{name:'Vocal'},{name:'Keys'}]]){
  const res=response();await changeOriginalProjectRole(request({action:'set_order',recordingOrder}),res);assert.equal(res.code,409);
 }
 const denied=response();await changeOriginalProjectRole(request({action:'set_order',recordingOrder:[]},{id:player}),denied);assert.equal(denied.code,403);assert.equal(writes.length,0);
});
test('saved recording plan and review deadline are manager-only workspace guidance', () => {
 const s=base();s.project.requestedRoles[1].recordingOrder=2;s.submissions=[{_id:'sub',roundId:'round',roleName:'Vocal',state:'submitted',submittedAt:'2026-11-05T10:00:00Z'}];
 const manager=presentOriginalWorkspace(s,{id:owner}),participant=presentOriginalWorkspace(s,{id:player});
 assert.equal(manager.recordingPlan.reviewDueAt,'2026-11-12T10:00:00.000Z');assert.equal(participant.recordingPlan,undefined);
 assert.equal(manager.roleProgress[1].recordingOrder,2);assert.equal(manager.roleProgress[0].isCurrent,true);
});
