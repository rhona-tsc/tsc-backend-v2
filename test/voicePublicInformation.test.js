import test from 'node:test';
import assert from 'node:assert/strict';
import { matchVoicePublicJobs } from '../services/voicePublicJobs.js';
import { getVoiceTechnicalGuidance } from '../services/voiceTechnicalGuidance.js';
import { createEnquiryToolHandler } from '../services/incomingEnquiryAssistant.js';
const now=new Date('2026-11-11T12:00:00Z');
const job={_id:'111111111111111111111111',title:'Saxophone deputy',date:'2027-06-05',status:'open',isReadyForApplications:true,requiredInstruments:['Saxophone'],county:'Surrey',fee:250,feeBasis:'per_day',currency:'GBP',jobType:'enquiry',createdByEmail:'PRIVATE',applications:[{email:'PRIVATE'}],stripeCustomerId:'PRIVATE',allocatedMusicianName:'PRIVATE',venue:'PRIVATE VENUE',roleRequirements:[{role:'Saxophone',quantity:1,privateContact:'PRIVATE'}]};
test('job lookup returns only bounded open public adverts and strips all private account, applicant, contact and payment fields',()=>{
 const result=matchVoicePublicJobs([job,{...job,_id:'222222222222222222222222',status:'draft'},{...job,status:'closed'},{...job,isReadyForApplications:false},{...job,date:'2025-01-01'},{...job,date:'TBC'},{...job,previewMode:true}],{query:'saxophone',eventDateISO:'2027-06-05'},now);
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].advertisedFee,250);assert.equal(result.jobs[0].feeBasis,'per_day');assert.equal(result.jobs[0].jobType,'enquiry_only');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|applications|stripeCustomerId|allocatedMusician/);assert.equal(result.applicationMade,false);assert.equal(result.identityVerified,false);
 assert.equal(matchVoicePublicJobs(Array.from({length:8},(_,i)=>({...job,_id:`${i}`.repeat(24)})),{},now).jobs.length,3);
 assert.equal(matchVoicePublicJobs([job],{query:'Drums'},now).jobs.length,0);
 assert.equal(matchVoicePublicJobs([job],{jobId:'222222222222222222222222'},now).jobs.length,0);
 assert.throws(()=>matchVoicePublicJobs([job],{eventDateISO:'2027-02-30'},now));
});
test('stage dimensions are explicit width by depth and stay planning guidance; unsupported sizes need review',()=>{
 for(const [count,width] of [[3,4],[4,4],[5,4],[6,5],[7,5],[8,5],[9,6],[10,6]]) {
  const result=getVoiceTechnicalGuidance({topic:'stage',bandSize:count});assert.equal(result.suggestedWidthMetres,width);assert.equal(result.suggestedDepthMetres,3);assert.equal(result.guidanceOnly,true);assert.equal(result.supplierConfirmed,false);
 }
 for(const bandSize of [undefined,2,11,'5-piece',-1]) assert.equal(getVoiceTechnicalGuidance({topic:'stage',bandSize}).needsClarification,true);
 const power=getVoiceTechnicalGuidance({topic:'power'});assert.equal(power.confirmedTotalWatts,null);assert.equal(power.confirmedTotalAmps,null);assert.equal(power.needsManagementReview,true);
 const lights=getVoiceTechnicalGuidance({topic:'lighting'});assert.equal(lights.typicalOptions.length,3);assert.equal(lights.supplierConfirmed,false);assert.equal(lights.bookingChecked,false);
});
test('public lookups never save enquiries, contact musicians or expose a private job action',async()=>{
 let reads=0;const handle=createEnquiryToolHandler({lookupJobs:async args=>{reads++;return matchVoicePublicJobs([job],args,now);},lookupBands:()=>assert.fail(),saveBoardRecord:()=>assert.fail(),prepareAvailability:()=>assert.fail()});
 const result=await handle({callId:'public_test',name:'lookup_musician_jobs',arguments:{query:'Saxophone'}});assert.equal(result.jobs.length,1);assert.equal(reads,1);
 const technical=await handle({callId:'public_test',name:'get_technical_guidance',arguments:{topic:'stage',bandSize:5}});assert.equal(technical.suggestedWidthMetres,4);
 await assert.rejects(handle({callId:'public_test',name:'apply_for_job',arguments:{}}));
});
