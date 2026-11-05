import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceOriginalRound } from '../services/originalsRoundProgressionService.js';
import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import { openNextOriginalRound, submitOriginalTakes } from '../controllers/originalsWorkflowController.js';
import { originalParticipation } from '../services/originalsMembershipService.js';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import Event from '../models/originalEventModel.js';
const owner='111111111111111111111111',winner='222222222222222222222222',other='333333333333333333333333',submitted='444444444444444444444444',projectId='555555555555555555555555',old='666666666666666666666666';
const now=new Date('2026-11-05T16:00:00Z');
const setup=t=>originalsTransactionStore(t,{
 projects:[{_id:projectId,ownerId:owner,currentRoundId:old,state:'foundation_open',title:'Original test',requestedRoles:[{name:'Click'},{name:'Vocal'},{name:'Guitar'}]}],
 rounds:[{_id:old,projectId,type:'foundation',eligibleRoles:['Click'],state:'open',sequence:0}],
 reservations:[{_id:'win',projectId,roundId:old,musicianId:winner,roleName:'Click',state:'submitted',slotHeld:true},{_id:'working',projectId,roundId:old,musicianId:other,roleName:'Click',state:'active',slotHeld:true,expiresAt:new Date('2030-01-01')},{_id:'pending',projectId,roundId:old,musicianId:submitted,roleName:'Click',state:'submitted',slotHeld:true}],
 submissions:[{_id:'selected',projectId,roundId:old,reservationId:'win',musicianId:winner,roleName:'Click',category:'contribution',state:'accepted',selectionMode:'whole_take',takes:[{stemAssetId:'chosen'}]},{_id:'unselected',projectId,roundId:old,reservationId:'pending',musicianId:submitted,roleName:'Click',category:'contribution',state:'submitted',takes:[{stemAssetId:'unused'}]}],
 assets:[{_id:'chosen',kind:'take_stem',state:'active'},{_id:'unused',kind:'take_stem',state:'active'},{_id:'new-recording',kind:'take_stem',state:'active',ownerId:other,reservationId:'working'}],
 invitations:[{_id:'old-invite',roundId:old,state:'pending'}],
});
const advance=()=>advanceOriginalRound({projectId,fromRoundId:old,type:'instrument',roleName:'Vocal',user:{id:owner},now});

test('advancement atomically closes remaining places, rejects pending alternatives and keeps the selected recording',async t=>{
 const s=setup(t);const result=await advance();assert.equal(result.cancelledPlaces,2);assert.equal(s.data.rounds.length,2);assert.equal(s.data.rounds[0].state,'closed');assert.equal(s.data.rounds[0].closureNotificationsPending,true);
 assert.equal(s.data.reservations[0].state,'submitted');assert.ok(s.data.reservations.slice(1).every(r=>r.state==='cancelled'&&r.slotHeld===false&&r.endedByRoundAdvance));
 assert.equal(s.data.submissions[1].state,'rejected');assert.equal(s.data.assets[0].state,'active');assert.equal(s.data.assets[1].state,'hidden');assert.equal(s.data.invitations[0].state,'cancelled');assert.equal(result.round.roleName,'Vocal');assert.equal(result.round.closesAt,null);assert.equal(result.round.clockStartedAt,null);
 const snapshot={project:s.data.projects[0],rounds:s.data.rounds,reservations:s.data.reservations,submissions:s.data.submissions,invitations:s.data.invitations};
 assert.equal(originalParticipation(snapshot,winner,now).canAccess,true);assert.equal(originalParticipation(snapshot,other,now).canAccess,false);assert.equal(originalParticipation(snapshot,submitted,now).notify,false);
});
test('an unfinished current round and an already completed instrument cannot be skipped or opened again',async t=>{
 const s=setup(t);s.data.submissions[0].state='submitted';const before=structuredClone(s.data);await assert.rejects(advance(),/Approve a submission/);assert.deepEqual(s.data,before);
 s.data.submissions[0].state='accepted';await assert.rejects(advanceOriginalRound({projectId,fromRoundId:old,type:'instrument',roleName:'Click',user:{id:owner},now}),/already has an approved/);assert.equal(s.data.rounds.length,1);
});
test('failure during advancement rolls back both the new round and closure of other musicians’ slots',async t=>{
 const s=setup(t);const before=structuredClone(s.data);t.mock.method(Event,'create',async()=>{throw new Error('Audit storage unavailable');});await assert.rejects(advance(),/Audit storage/);assert.deepEqual(s.data,before);
});
test('two owners advancing the same round can only create one next stage',async t=>{
 const s=setup(t);const results=await Promise.allSettled([advance(),advance()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.data.rounds.length,2);assert.match(results.find(r=>r.status==='rejected').reason.message,/already moved/);
});
test('a stale submit cannot restore a reservation after the project advances',async t=>{
 const s=setup(t);await advance();await assert.rejects(originalSubmissionCommit.run({reservationId:'working',musicianId:other,payload:{projectId,roundId:old,reservationId:'working',musicianId:other,roleName:'Click',takes:[{stemAssetId:'new-recording'}]},now}),/round has closed/);assert.equal(s.data.reservations[1].state,'cancelled');assert.equal(s.data.submissions.length,2);
});
test('a take committed immediately before advancement is included in the closed alternatives',async t=>{
 const s=setup(t);await originalSubmissionCommit.run({reservationId:'working',musicianId:other,payload:{projectId,roundId:old,reservationId:'working',musicianId:other,roleName:'Click',category:'contribution',takes:[{stemAssetId:'new-recording'}]},now});assert.equal(s.data.submissions.at(-1).state,'submitted');await advance();assert.equal(s.data.submissions.at(-1).state,'rejected');assert.equal(s.data.assets.at(-1).state,'hidden');assert.equal(s.data.reservations[1].state,'cancelled');
});
test('the HTTP next-round action returns the committed new round and preserves its clock until reservation',async t=>{
 const s=setup(t);const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await openNextOriginalRound({params:{id:projectId},user:{id:owner},body:{type:'instrument',roleName:'Guitar',fromRoundId:old}},res);assert.equal(res.code,201);assert.equal(res.body.round.roleName,'Guitar');assert.equal(s.data.rounds.length,2);assert.equal(res.body.round.clockStartedAt,null);
});
