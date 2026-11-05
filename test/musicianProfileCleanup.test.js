import test from 'node:test';
import assert from 'node:assert/strict';
import { planMusicianProfileCleanup, privateTestProfileUpdate } from '../services/musicianProfileCleanupService.js';

test('cleanup matches only the requested email patterns, preserving both protected accounts',()=>{
 const records=['hello@thesupremecollective.co.uk','RHONA@thesupremecollective.co.uk','someone@thesupremecollective.co.uk','tsc+band@gmail.com','TSCtest@gmail.com','ordinary@gmail.com','rhonagdownie@gmail.com','tscother@googlemail.com','other@notthesupremecollective.co.uk','other@thesupremecollective.co.uk.fake'].map(email=>({email}));
 const plan=planMusicianProfileCleanup(records);assert.equal(plan.protected.length,2);assert.deepEqual(plan.remove.map(r=>r.email),records.slice(2,5).map(r=>r.email));assert.equal(plan.retainAsTest.length,0);
});
test('only a Rowan whose email matches the cleanup formats is retained as Test',()=>{
 const real={email:'rowan@example.test',firstName:'Rowan'},test={email:'rowan@thesupremecollective.co.uk',firstName:' Rowan '},legacy={email:'tscrowan@gmail.com',basicInfo:{firstName:'ROWAN'}};
 const plan=planMusicianProfileCleanup([real,test,legacy]);assert.deepEqual(plan.retainAsTest,[test,legacy]);assert.deepEqual(plan.remove,[]);assert.equal(real.firstName,'Rowan');
});
test('private test rename changes both name representations without changing login email or recordings',()=>{
 assert.equal(privateTestProfileUpdate.firstName,'Test');assert.equal(privateTestProfileUpdate.lastName,'');assert.equal(privateTestProfileUpdate['basicInfo.firstName'],'Test');assert.equal(privateTestProfileUpdate['basicInfo.lastName'],'');assert.equal(privateTestProfileUpdate.privateTestProfile,true);assert.equal(privateTestProfileUpdate.email,undefined);assert.equal(privateTestProfileUpdate.profilePhoto,undefined);
});

test('re-running cleanup preserves the already renamed private Test profile',()=>{
 const row={email:'rowan@thesupremecollective.co.uk',firstName:'Test',privateTestProfile:true,musicianSlug:'tsc-invite-test'};
 const plan=planMusicianProfileCleanup([row]);assert.deepEqual(plan.remove,[]);assert.deepEqual(plan.retainAsTest,[row]);
});
