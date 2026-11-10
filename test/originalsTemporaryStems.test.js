import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { originalRecordingContext } from '../services/originalsRecordingContextService.js';
import { requireOriginalTemporaryReplacements, saveOriginalTemporaryStem, validateOriginalTemporaryStem } from '../services/originalsTemporaryStemService.js';
import { uploadOriginalAsset } from '../controllers/originalsWorkflowController.js';
import { advanceOriginalRound } from '../services/originalsRoundProgressionService.js';
import { completeOriginalProject, createOriginalCreditVersion } from '../controllers/originalsCreditsController.js';

const owner='111111111111111111111111', projectId='222222222222222222222222', roundId='333333333333333333333333';
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const project=()=>({_id:projectId,ownerId:owner,title:'Groove',state:'role_round_open',currentRoundId:roundId,sourceType:'temporary_stem',requestedRoles:[{name:'Keyboard'},{name:'Bass'}],initialAssetIds:[]});
const temporary=()=>({_id:'temporary',projectId,kind:'temporary_stem',state:'active',finalEligible:false,replacementRoleName:'Keyboard',originalName:'Temporary keys.wav'});
const chosen=(roleName,stem,state='accepted')=>({_id:`submission-${stem}`,projectId,roundId,category:'contribution',roleName,state,selectionMode:'whole_take',selectedTakeId:`take-${stem}`,takes:[{_id:`take-${stem}`,stemAssetId:stem}]});
const real=stem=>({_id:stem,projectId,kind:'take_stem',state:'active',finalEligible:true});

test('temporary stems need a real replacement role and cannot be introduced after recording',()=>{
 assert.equal(validateOriginalTemporaryStem(project(),' keyboard '),'Keyboard');
 assert.throws(()=>validateOriginalTemporaryStem(project(),'Missing'),error=>error.status===400);
 assert.throws(()=>validateOriginalTemporaryStem({...project(),state:'mix_open'},'Keyboard'),error=>error.status===409);
});

test('temporary stems remain in recording context until the correct approved selection replaces them',()=>{
 const assets=[temporary(),real('keys'),real('bass')], selected=chosen('Keyboard','keys');
 for(const submissions of [[],[chosen('Bass','bass')],[{...selected,state:'submitted'}],[{...selected,state:'rejected'}],[{...selected,selectedTakeId:'missing'}]]) {
  assert.ok(originalRecordingContext({project:project(),assets,submissions}).tracks.some(track=>track._id==='temporary'));
 }
 assert.deepEqual(originalRecordingContext({project:project(),assets,submissions:[selected]}).tracks.map(track=>track._id),['keys']);
 const partial={...selected,selectionMode:'selected_ranges',selectedRanges:[{takeId:'take-keys',startSeconds:1,endSeconds:4}]};
 assert.deepEqual(originalRecordingContext({project:project(),assets,submissions:[partial]}).tracks.map(track=>track._id),['keys']);
 assert.ok(originalRecordingContext({project:project(),assets,submissions:[{...partial,selectedRanges:[{takeId:'take-keys',startSeconds:4,endSeconds:1}]}]}).tracks.some(track=>track._id==='temporary'));
 assert.ok(originalRecordingContext({project:project(),assets,submissions:[{...selected,state:'retracted'}]}).tracks.some(track=>track._id==='temporary'));
});

test('temporary upload saves its AI declaration, role and non-final status with its project linkage',async t=>{
 const store=originalsTransactionStore(t,{projects:[{...project(),state:'draft'}]});
 const upload=t.mock.method(cloudinary.uploader,'upload_stream',(_options,callback)=>({end(){callback(null,{public_id:'private/temporary',resource_type:'video',format:'wav'});}}));
 const req={params:{id:projectId},user:{id:owner},body:{kind:'temporary_stem',replacementRoleName:'keyboard',createdEntirelyWithAi:'true'},file:{originalname:'Keys.wav',mimetype:'audio/wav',size:4,buffer:Buffer.from('keys')}};
 const res=response();await uploadOriginalAsset(req,res);
 assert.equal(res.code,201);assert.equal(upload.mock.callCount(),1);
 const asset=store.data.assets[0];assert.equal(asset.kind,'temporary_stem');assert.equal(asset.finalEligible,false);assert.equal(asset.replacementRoleName,'Keyboard');assert.equal(asset.createdEntirelyWithAi,true);
 assert.deepEqual(store.data.projects[0].initialAssetIds,[asset._id]);assert.equal(store.data.projects[0].hasInitialStem,true);
});

test('an upload finishing after the final mix opens is rejected atomically',async t=>{
 const store=originalsTransactionStore(t,{projects:[{...project(),state:'mix_open'}]});
 await assert.rejects(saveOriginalTemporaryStem({projectId,data:{...temporary(),replacementRoleName:'Keyboard'}}),error=>error.status===409);
 assert.equal(store.data.assets.length,0);assert.deepEqual(store.data.projects[0].initialAssetIds,[]);
});

test('final-mix progression waits for replacement, then succeeds with the approved recording',async t=>{
 const store=originalsTransactionStore(t,{projects:[project()],rounds:[{_id:roundId,projectId,state:'open',sequence:1,type:'instrument',roleName:'Bass'}],assets:[temporary(),real('bass'),real('keys')],submissions:[chosen('Bass','bass')]});
 const request={projectId,fromRoundId:roundId,type:'mix',user:{id:owner}};
 await assert.rejects(advanceOriginalRound(request),error=>error.code==='ORIGINALS_TEMPORARY_STEMS_PENDING');
 assert.equal(store.data.rounds.length,1);assert.equal(store.data.projects[0].state,'role_round_open');
 store.data.submissions.push(chosen('Keyboard','keys'));
 const result=await advanceOriginalRound(request);assert.equal(result.round.type,'mix');assert.equal(store.data.projects[0].state,'mix_open');
});

test('completion and final credits cannot bypass unresolved temporary parts',async t=>{
 const store=originalsTransactionStore(t,{projects:[{...project(),state:'credits_confirmation',currentCreditVersionId:'credit'}],credits:[{_id:'credit',projectId,state:'final'}],assets:[temporary(),real('keys')],submissions:[{_id:'master',projectId,category:'master',state:'accepted'}]});
 const req={params:{id:projectId},user:{id:owner}};
 const credits=response();await createOriginalCreditVersion(req,credits);assert.equal(credits.code,409);assert.equal(credits.body.code,'ORIGINALS_TEMPORARY_STEMS_PENDING');assert.equal(store.data.credits.length,1);
 const refused=response();await completeOriginalProject(req,refused);assert.equal(refused.code,409);assert.equal(store.data.projects[0].state,'credits_confirmation');
 store.data.submissions.push(chosen('Keyboard','keys'));
 await requireOriginalTemporaryReplacements({projectId});
 const completed=response();await completeOriginalProject(req,completed);assert.equal(completed.code,200);assert.equal(store.data.projects[0].state,'approved_master');
});

test('temporary upload updates a real project document using its current saved version',async t=>{
 const {default:mongoose}=await import('mongoose');
 const {default:Project}=await import('../models/originalProjectModel.js');
 const {default:Asset}=await import('../models/originalAssetModel.js');
 const doc=Project.hydrate({...project(),__v:7});
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async work=>work(),endSession:async()=>{}}));
 t.mock.method(Project,'findById',()=>({session:async()=>doc}));
 t.mock.method(Asset,'create',async()=>[{_id:'444444444444444444444444'}]);
 t.mock.method(doc,'save',async()=>{const [where,update]=doc.$__delta();assert.equal(where.__v,7);assert.equal(update.$inc.__v,1);return doc;});
 await saveOriginalTemporaryStem({projectId,data:{replacementRoleName:'Keyboard'}});
});
