import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { originalRecordingContext, loadOriginalRecordingContext, requireOriginalStemReviews } from '../services/originalsRecordingContextService.js';
import { getOriginalStemPreview, confirmOriginalStemReview, streamOriginalAudio } from '../controllers/originalsRecordingController.js';
import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import { v2 as cloudinary } from 'cloudinary';
const projectId='111111111111111111111111', owner='222222222222222222222222', player='333333333333333333333333', roundId='444444444444444444444444', reservationId='555555555555555555555555', stemId='666666666666666666666666', approvedId='777777777777777777777777', oldTakeId='888888888888888888888888';
const response=()=>({code:200,status(code){this.code=code;return this;},set(){return this;},json(body){this.body=body;return this;}});
function setup(t){return originalsTransactionStore(t,{
 projects:[{_id:projectId,ownerId:owner,currentRoundId:roundId,state:'role_round_open'}],
 rounds:[{_id:roundId,projectId,type:'instrument',roleName:'Bass',state:'open'}],
 reservations:[{_id:reservationId,projectId,roundId,musicianId:player,state:'active',roleName:'Bass',expiresAt:new Date('2030-01-01')}],
 assets:[{_id:stemId,projectId,reservationId,ownerId:player,kind:'take_stem',state:'active',mimeType:'audio/wav',originalName:'Bass.wav',alignmentReviewRequired:true},{_id:approvedId,projectId,ownerId:owner,kind:'take_stem',state:'active',mimeType:'audio/wav',originalName:'Foundation.wav'},{_id:'unselected',projectId,kind:'take_stem',state:'active',originalName:'Private alternative'},{_id:'wet',projectId,kind:'take_stem',state:'active',originalName:'Private effects'}],
 submissions:[{_id:'accepted',projectId,roleName:'Click',category:'contribution',state:'accepted',takes:[{_id:oldTakeId,stemAssetId:approvedId,wetStemAssetId:'wet'},{_id:'unselected-option',stemAssetId:'unselected'}],selectionMode:'selected_ranges',selectedRanges:[{takeId:oldTakeId,startSeconds:1,endSeconds:3}]}],
});}
const req=body=>({params:{assetId:stemId},user:{id:player},body});
test('preview context includes only selected approved stems and ranges, excluding alternatives and effects',async t=>{
 setup(t);const res=response();await getOriginalStemPreview(req(),res);assert.equal(res.code,200);assert.deepEqual(res.body.tracks.map(track=>String(track._id)),[approvedId]);assert.deepEqual(res.body.tracks[0].playbackRanges,[{startSeconds:1,endSeconds:3}]);assert.equal(res.body.contextKey.length,64);
 assert.doesNotMatch(JSON.stringify(res.body),/Private alternative|Private effects/);
});
test('only the uploader can confirm, with a positive declaration and current project snapshot',async t=>{
 const s=setup(t);let res=response();await getOriginalStemPreview({...req(),user:{id:owner}},res);assert.equal(res.code,403);
 res=response();await confirmOriginalStemReview(req({reviewed:false}),res);assert.equal(res.code,400);assert.equal(s.data.assets[0].alignmentReview,undefined);
 res=response();await confirmOriginalStemReview(req({reviewed:true,contextKey:'stale'}),res);assert.equal(res.code,409);
 const context=await loadOriginalRecordingContext({projectId});res=response();await confirmOriginalStemReview(req({reviewed:true,contextKey:context.contextKey}),res);assert.equal(res.code,200);assert.equal(s.data.assets[0].alignmentReview.reviewedBy,player);assert.ok(s.data.assets[0].alignmentReview.reviewedAt instanceof Date);
});
test('new stems cannot bypass the alignment check even by calling the commit service directly',async t=>{
 const s=setup(t),payload={projectId,roundId,reservationId,musicianId:player,roleName:'Bass',category:'contribution',songwritingChoice:'master_only',takes:[{stemAssetId:stemId}]};
 await assert.rejects(originalSubmissionCommit.run({reservationId,musicianId:player,payload}),error=>error.code==='ORIGINALS_ALIGNMENT_REVIEW_REQUIRED'&&error.assetId===stemId);
 assert.equal(s.data.submissions.length,1);assert.equal(s.data.reservations[0].state,'active');
 const context=await loadOriginalRecordingContext({projectId});await confirmOriginalStemReview(req({reviewed:true,contextKey:context.contextKey}),response());
 const saved=await originalSubmissionCommit.run({reservationId,musicianId:player,payload});assert.equal(saved.listeningMixRequired,false);assert.equal(saved.takes[0].mixdownAssetId,undefined);assert.equal(s.data.reservations[0].state,'submitted');
});
test('a new approval or range change invalidates an earlier listening acknowledgement',async t=>{
 const s=setup(t),context=await loadOriginalRecordingContext({projectId});await confirmOriginalStemReview(req({reviewed:true,contextKey:context.contextKey}),response());
 await requireOriginalStemReviews({assets:[s.data.assets[0]],musicianId:player});
 s.data.submissions[0].selectedRanges[0].endSeconds=4;
 await assert.rejects(requireOriginalStemReviews({assets:[s.data.assets[0]],musicianId:player}),/current project tracks/);
});
test('guides are used only before there is an approved recording; legacy uploads remain usable',async t=>{
 const s=setup(t);s.data.assets.push({_id:'guide',projectId,kind:'guide_track',state:'active',mimeType:'audio/wav'});
 let context=originalRecordingContext({project:s.data.projects[0],assets:s.data.assets,submissions:s.data.submissions});assert.ok(!context.tracks.some(track=>track._id==='guide'));
 context=originalRecordingContext({project:s.data.projects[0],assets:s.data.assets,submissions:[]});assert.deepEqual(context.tracks.map(track=>track._id),['guide']);
 await requireOriginalStemReviews({assets:[{...s.data.assets[0],alignmentReviewRequired:false}],musicianId:player});
});
test('authenticated audio streaming preserves bytes and denies private, hidden and non-audio files',async t=>{
 const s=setup(t),bytes=Buffer.from('RIFF-test-source-audio');let fetched=0;
 t.mock.method(cloudinary.utils,'private_download_url',()=> 'https://api.cloudinary.com/private-test');
 const realFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('http://127.0.0.1'))return realFetch(url,options);fetched++;return new Response(bytes,{status:200});});
 const app=express();app.get('/audio/:assetId', (req,res,next)=>{req.user={id: req.query.viewer||player};next();},streamOriginalAudio);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}/audio/${stemId}`;
 let result=await fetch(base);assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);assert.equal(result.headers.get('cache-control'),'private, no-store');
 result=await fetch(base+'?viewer=aaaaaaaaaaaaaaaaaaaaaaaa');assert.equal(result.status,403);assert.equal(fetched,1);
 s.data.assets[0].state='hidden';result=await fetch(base);assert.equal(result.status,404);assert.equal(fetched,1);
 s.data.assets[0].state='active';s.data.assets[0].mimeType='video/mp4';result=await fetch(base);assert.equal(result.status,415);assert.equal(fetched,1);
});
