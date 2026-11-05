import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import Musician from '../models/musicianModel.js';
import {canSeePrivateTestMusicians,musicianDirectoryVisibility} from '../services/musicianDirectoryVisibility.js';
import {browseOriginalMusicians} from '../services/originalsMusicianDirectoryService.js';
const privateId='111111111111111111111111',publicId='222222222222222222222222';
const rows=[{_id:privateId,firstName:'Test',lastName:'',email:'rowan@thesupremecollective.co.uk',privateTestProfile:true,musicianSlug:'tsc-invite-test',role:'musician',status:'approved',profilePhoto:'https://res.cloudinary.com/dvcgr3fyd/image/upload/example.jpg'},{_id:publicId,firstName:'Rowan',lastName:'Thomas',email:'rowan@example.test',role:'musician',status:'approved'}];
function stub(t){const calls=[];t.mock.method(Musician,'find',filter=>{calls.push(filter);let skip=0,limit=100;const result=rows.filter(r=>filter.privateTestProfile?.$ne===true?!r.privateTestProfile:true);return {select(){return this;},sort(){return this;},skip(n){skip=n;return this;},limit(n){limit=n;return this;},lean:async()=>result.slice(skip,skip+limit)};});t.mock.method(Musician,'findById',id=>({lean:async()=>rows.find(r=>r._id===id)}));t.mock.method(Musician,'findOne',q=>({lean:async()=>rows.find(r=>r.musicianSlug===q.musicianSlug)}));return calls;}

test('private directory permission belongs to Rhona identities, not agents or project owners generally',()=>{
 for(const email of ['hello@thesupremecollective.co.uk','RHONA@thesupremecollective.co.uk','rhonagdownie@gmail.com'])assert.equal(canSeePrivateTestMusicians({email}),true);
 for(const user of [{},{role:'agent',email:'other@thesupremecollective.co.uk'},{role:'admin'},{email:'hello@thesupremecollective.co.uk.fake'},{email:'tscplayer@gmail.com'}])assert.deepEqual(musicianDirectoryVisibility(user),{privateTestProfile:{$ne:true}});
});
test('Originals browse excludes the test profile for everyone else and prevents query-string identity overrides',async t=>{
 const calls=stub(t);const hidden=await browseOriginalMusicians({email:'hello@thesupremecollective.co.uk',privateTestProfile:'true'},{viewer:{email:'other@example.test'},allowEmail:true});assert.deepEqual(hidden.musicians.map(r=>r._id),[publicId]);assert.equal(calls[0].privateTestProfile.$ne,true);
 const mine=await browseOriginalMusicians({},{viewer:{email:'hello@thesupremecollective.co.uk'}});assert.equal(mine.musicians.length,2);const profile=mine.musicians.find(r=>r._id===privateId);assert.equal(profile.displayName,'Test');assert.equal(profile.profilePath,null);assert.match(profile.profilePhoto,/https:/);assert.doesNotMatch(JSON.stringify(profile),/rowan@|phone|password/);
});
test('public profile routes and legacy aliases do not expose a private test profile, even by direct ID',async t=>{
 stub(t);t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});
 const refresh=process.env.GOOGLE_REFRESH_TOKEN;process.env.GOOGLE_REFRESH_TOKEN='';t.after(()=>{if(refresh!==undefined)process.env.GOOGLE_REFRESH_TOKEN=refresh;});
 const{default:router}=await import('../routes/musicianRoute.js');
 for(const path of ['/profile/:idOrSlug','/get/:idOrSlug','/:idOrSlug']){
  const route=router.stack.find(l=>l.route?.path===path&&l.route.methods.get);if(!route&&path==='/:idOrSlug')continue;assert.ok(route,path);
  for(const idOrSlug of [privateId,'tsc-invite-test']){const res={code:200,status(c){this.code=c;return this;},json(data){this.data=data;return this;}};await route.route.stack.at(-1).handle({params:{idOrSlug}},res);assert.equal(res.code,404,path);}
 }
});
test('authenticated general musician search applies the same private-profile rule',async t=>{
 stub(t);t.mock.method(console,'log',()=>{});const{default:express}=await import('express');const{default:router}=await import('../routes/musicianRoute.js');
 const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='private-directory-test-only';t.after(()=>{if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;});
 const app=express();app.use('/api/musician',router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 for(const[email,count]of[['hello@thesupremecollective.co.uk',2],['other@thesupremecollective.co.uk',1]]){const token=jwt.sign({id:publicId,email,role:'agent'},process.env.JWT_SECRET);const res=await fetch(`http://127.0.0.1:${server.address().port}/api/musician/search?q=Test`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(res.status,200);const data=await res.json();assert.equal(data.musicians.length,count);}
});

test('another project owner cannot invite the private Test profile by guessing its ID',async t=>{
 const {inviteOriginalMusician}=await import('../controllers/originalsWorkflowController.js');
 const {default:Project}=await import('../models/originalProjectModel.js');const{default:Round}=await import('../models/originalRoundModel.js');const{default:Invitation}=await import('../models/originalInvitationModel.js');const{default:Event}=await import('../models/originalEventModel.js');
 t.mock.method(Project,'findById',()=>({lean:async()=>({_id:publicId,ownerId:publicId})}));
 t.mock.method(Round,'findOne',async()=>({_id:privateId,projectId:publicId,type:'instrument',roleName:'Drums',state:'open'}));
 t.mock.method(Musician,'findById',()=>({select(fields){assert.ok(fields.includes('privateTestProfile'));return Promise.resolve(rows[0]);}}));
 const create=t.mock.method(Invitation,'create',async row=>({_id:privateId,...row}));t.mock.method(Event,'create',async()=>({}));
 for(const[email,expected]of[['other@example.test',404],['hello@thesupremecollective.co.uk',201]]){
  const res={code:200,status(c){this.code=c;return this;},json(body){this.body=body;return this;}};
  await inviteOriginalMusician({params:{roundId:privateId},user:{id:publicId,email},body:{musicianId:privateId,roleName:'Drums'}},res);assert.equal(res.code,expected);
 }
 assert.equal(create.mock.callCount(),1);
});
