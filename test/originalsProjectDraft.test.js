import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { beginOriginalDraftEdit, saveOriginalDraftEdit } from '../services/originalsProjectDraftService.js';
import { getOriginalOwnerAgreement, originalOwnerAgreementAcceptance } from '../services/originalsAgreementService.js';
import { decideOriginalProjectModeration } from '../controllers/originalsController.js';

const owner='111111111111111111111111',other='222222222222222222222222',projectId='333333333333333333333333';
const inputAgreement=()=>({ownerAgreementAccepted:true,ownerAgreementDisplayName:'Project Owner',ownerAgreement:getOriginalOwnerAgreement()});
const project=()=>({_id:projectId,ownerId:owner,title:'Woke Up',description:'Original idea',genres:['Soul'],state:'pending_moderation',moderation:{status:'pending',submittedAt:new Date()},currentRoundId:null,publishedAt:null,sourceType:'final_eligible_stem',requestedRoles:[{name:'Keyboard'},{name:'Bass'}],initialAssetIds:['keys','idea'],ownerAgreement:originalOwnerAgreementAcceptance(inputAgreement())});
const assets=()=>[{_id:'keys',projectId,ownerId:owner,kind:'initial_stem',state:'active',mimeType:'audio/wav',finalEligible:true,createdEntirelyWithAi:true},{_id:'idea',projectId,ownerId:owner,kind:'guide_track',state:'active',mimeType:'audio/wav',finalEligible:false}];
const identity={projectId,musicianId:owner,user:{id:owner}};
const kept=[{assetId:'keys',kind:'temporary_stem',replacementRoleName:'Keyboard',createdEntirelyWithAi:true}];

test('opening a pending submission returns it to draft, retains files and records the previous moderation once',async t=>{
 const store=originalsTransactionStore(t,{projects:[project()],assets:assets()});
 const result=await beginOriginalDraftEdit(identity);
 assert.equal(result.project.state,'draft');assert.equal(result.project.moderation.status,'not_submitted');assert.equal(result.assets.length,2);
 assert.equal(store.data.events.length,1);assert.equal(store.data.events[0].metadata.previousModeration.status,'pending');
 await beginOriginalDraftEdit(identity);assert.equal(store.data.events.length,1);assert.equal(store.data.projects.length,1);
 const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await decideOriginalProjectModeration({params:{id:projectId},user:{id:other,role:'admin'},body:{decision:'approve'}},res);
 assert.equal(res.code,409);assert.equal(store.data.projects[0].state,'draft');
});

test('owners cannot reopen someone else’s submission or an already approved project',async t=>{
 const store=originalsTransactionStore(t,{projects:[project()]});
 await assert.rejects(beginOriginalDraftEdit({...identity,musicianId:other}),error=>error.status===403);
 store.data.projects[0].state='role_round_open';store.data.projects[0].currentRoundId='round';store.data.projects[0].publishedAt=new Date();
 await assert.rejects(beginOriginalDraftEdit(identity),error=>error.status===409);
 assert.equal(store.data.events.length,0);
});

test('draft changes reclassify an existing stem, remove an unwanted reference without destroying it, and preserve consent evidence',async t=>{
 const original=project();original.state='draft';original.moderation.status='not_submitted';
 const store=originalsTransactionStore(t,{projects:[original],assets:assets()});
 await saveOriginalDraftEdit({...identity,fields:{title:'Woke Up — revised',sourceType:'temporary_stem',hasInitialStem:true},input:{assets:kept}});
 assert.equal(store.data.projects[0].title,'Woke Up — revised');assert.equal(store.data.projects[0].state,'draft');
 assert.equal(store.data.assets[0].kind,'temporary_stem');assert.equal(store.data.assets[0].replacementRoleName,'Keyboard');assert.equal(store.data.assets[0].finalEligible,false);
 assert.equal(store.data.assets[1].state,'deleted');assert.deepEqual(store.data.projects[0].initialAssetIds,['keys']);
 assert.deepEqual(store.data.projects[0].ownerAgreement,original.ownerAgreement);
});

test('invalid file ownership or replacement roles roll back the complete edit',async t=>{
 const store=originalsTransactionStore(t,{projects:[{...project(),state:'draft'}],assets:assets()});
 for(const manifest of [[{assetId:'foreign',kind:'guide_track'}],[{...kept[0],replacementRoleName:'Missing'}]]) {
  await assert.rejects(saveOriginalDraftEdit({...identity,fields:{title:'Must not save'},input:{assets:manifest}}),error=>error.status===400);
  assert.equal(store.data.projects[0].title,'Woke Up');assert.equal(store.data.assets[0].kind,'initial_stem');assert.equal(store.data.assets[1].state,'active');
 }
});

test('preferred musician changes keep prior holds as cancelled history and create the new waiting place',async t=>{
 const store=originalsTransactionStore(t,{projects:[{...project(),state:'draft'}],assets:assets(),musicians:[{_id:other,firstName:'Ewan',lastName:'Musician',profileDeletedAt:null}],futures:[{_id:'old-hold',projectId,musicianId:other,roleName:'Bass',roleKey:'bass',state:'waiting',assignedByOwner:true}]});
 await saveOriginalDraftEdit({...identity,fields:{sourceType:'temporary_stem'},input:{assets:kept,preferredMusicians:[{roleName:'Keyboard',musicianId:other}]}});
 assert.equal(store.data.futures[0].state,'cancelled');assert.equal(store.data.futures[1].state,'waiting');assert.equal(store.data.futures[1].roleName,'Keyboard');assert.equal(store.data.futures[1].agreementAcceptanceId,undefined);
});

test('resubmission acceptance retains the previous signed agreement and records the updated project title',async t=>{
 const original=project();original.state='draft';
 const store=originalsTransactionStore(t,{projects:[original],assets:assets()});
 await saveOriginalDraftEdit({...identity,fields:{title:'Updated title'},input:{assets:kept,...inputAgreement()}});
 assert.deepEqual(store.data.projects[0].ownerAgreementHistory[0],original.ownerAgreement);
 assert.equal(store.data.projects[0].ownerAgreement.projectTitle,'Updated title');
});
