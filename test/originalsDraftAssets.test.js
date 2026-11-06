import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteOriginalDraftAsset } from '../services/originalsDraftAssetService.js';
import { deleteOriginalUploadedRecording } from '../controllers/originalsDraftAssetController.js';
import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import { authoriseOriginalAsset } from '../services/originalsAssetAccessService.js';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import Event from '../models/originalEventModel.js';
const musicianId='111111111111111111111111',assetId='222222222222222222222222',projectId='333333333333333333333333',roundId='444444444444444444444444',reservationId='555555555555555555555555';
const now=new Date('2026-11-06T12:00:00Z');
const setup=t=>originalsTransactionStore(t,{
 projects:[{_id:projectId,currentRoundId:roundId,initialAssetIds:[]}],
 rounds:[{_id:roundId,projectId,state:'open',type:'instrument'}],
 reservations:[{_id:reservationId,projectId,roundId,musicianId,state:'active',expiresAt:new Date('2030-01-01')}],
 assets:[{_id:assetId,projectId,roundId,reservationId,ownerId:musicianId,state:'active',kind:'take_stem'}],
});
const remove=()=>deleteOriginalDraftAsset({assetId,musicianId,now});
const submit=()=>originalSubmissionCommit.run({reservationId,musicianId,now,payload:{projectId,roundId,reservationId,musicianId,category:'contribution',takes:[{stemAssetId:assetId}]}});

test('deleting an own draft revokes file access while retaining the reservation and audit record',async t=>{
 const s=setup(t);await remove();assert.equal(s.data.assets[0].state,'deleted');assert.equal(s.data.reservations[0].state,'active');assert.equal(s.data.events[0].type,'draft_asset_deleted');
 await assert.rejects(authoriseOriginalAsset({params:{assetId},user:{id:musicianId}}),{status:404});await assert.rejects(submit(),/no longer available/);
 await assert.rejects(remove(),{status:404});assert.equal(s.data.events.length,1);
});
for(const kind of ['mix','master','take_mixdown']) test(`an unsubmitted ${kind} upload can be deleted`,async t=>{const s=setup(t);s.data.assets[0].kind=kind;await remove();assert.equal(s.data.assets[0].state,'deleted');});
for(const [label,change,status] of [
 ['another musician’s file',s=>{s.assets[0].ownerId='someone-else';},404],
 ['submitted reservation',s=>{s.reservations[0].state='submitted';},409],
 ['expired reservation',s=>{s.reservations[0].expiresAt=new Date('2020-01-01');},409],
 ['reference file',s=>{s.assets[0].kind='click_track';},409],
 ['a submitted take',s=>{s.submissions.push({reservationId,state:'submitted',takes:[{stemAssetId:assetId}]});},409],
 ['an accepted output',s=>{s.submissions.push({reservationId:'another',state:'accepted',outputAssetId:assetId});},409],
 ['a rejected submission',s=>{s.submissions.push({reservationId,state:'rejected'});},409],
 ['an initial project file',s=>{s.projects[0].initialAssetIds=[assetId];},409],
 ['a past round',s=>{s.projects[0].currentRoundId='next';},409],
 ['a closed round',s=>{s.rounds[0].state='closed';},409],
]) test(`cannot delete ${label}`,async t=>{const s=setup(t);change(s.data);const before=structuredClone(s.data);await assert.rejects(remove(),{status});assert.deepEqual(s.data,before);});
test('audit failure rolls back draft deletion',async t=>{const s=setup(t),before=structuredClone(s.data);t.mock.method(Event,'create',async()=>{throw Error('Audit unavailable');});await assert.rejects(remove(),/Audit unavailable/);assert.deepEqual(s.data,before);});
for(const first of ['delete','submit']) test(`concurrent deletion and submission preserve the winner (${first} first)`,async t=>{
 const s=setup(t);const results=await Promise.allSettled(first==='delete'?[remove(),submit()]:[submit(),remove()]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
 assert.equal(s.data.assets[0].state,first==='delete'?'deleted':'active');assert.equal(s.data.submissions.length,first==='delete'?0:1);
});
test('delete controller validates IDs and returns safe errors and successful responses',async t=>{
 const s=setup(t);const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 let res=response();await deleteOriginalUploadedRecording({params:{assetId:'invalid'},user:{id:musicianId}},res);assert.equal(res.code,400);
 res=response();await deleteOriginalUploadedRecording({params:{assetId},user:{id:'other'}},res);assert.equal(res.code,404);assert.equal(s.data.assets[0].state,'active');
 res=response();await deleteOriginalUploadedRecording({params:{assetId},user:{id:musicianId}},res);assert.equal(res.code,200);assert.equal(res.body.success,true);assert.equal(s.data.assets[0].state,'deleted');
});
