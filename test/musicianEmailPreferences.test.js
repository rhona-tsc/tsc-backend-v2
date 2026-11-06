import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import express from 'express';
import Preferences from '../models/musicianEmailPreferenceModel.js';
import Musician from '../models/musicianModel.js';
import router from '../routes/musicianEmailPreferencesRoutes.js';
import { musicianEmailPreferencesUrl, verifyMusicianEmailPreferencesToken, musicianEmailHash } from '../utils/musicianEmailPreferences.js';
import { musicianOpportunityAllowed } from '../services/musicianEmailPreferenceService.js';
import { canSeeMusicianInDirectory } from '../services/musicianDirectoryVisibility.js';
import sendEmail from '../utils/sendEmail.js';
import { buildOriginalSubmissionConfirmationEmail } from '../utils/originalsSubmissionConfirmationEmail.js';
const self='111111111111111111111111',other='222222222222222222222222';
async function setup(t) {
  const env={JWT_SECRET:process.env.JWT_SECRET,EMAIL_UNSUBSCRIBE_SECRET:process.env.EMAIL_UNSUBSCRIBE_SECRET,ADMIN_FRONTEND_URL:process.env.ADMIN_FRONTEND_URL};
  process.env.JWT_SECRET='preferences-auth-test';process.env.EMAIL_UNSUBSCRIBE_SECRET='preferences-link-test';process.env.ADMIN_FRONTEND_URL='https://admin.example.test';
  t.after(()=>{for(const[key,value]of Object.entries(env))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});
  const records=new Map(),musicians=new Map([[self,{_id:self,email:'musician@example.test',firstName:'Sam',status:'approved'}],[other,{_id:other,email:'other@example.test'}]]);let writes=0;
  t.mock.method(Preferences,'findOne',({emailHash})=>({lean:async()=>records.get(emailHash)}));
  t.mock.method(Preferences,'updateOne',async({emailHash},update)=>{writes++;records.set(emailHash,{...records.get(emailHash),...update.$set});return{matchedCount:1};});
  t.mock.method(Musician,'findById',id=>({select(){return this;},lean:async()=>musicians.get(String(id))}));
  t.mock.method(Musician,'updateOne',async({_id},update)=>{writes++;Object.assign(musicians.get(String(_id)),update.$set);return{matchedCount:1};});
  const app=express();app.use(express.json());app.use('/preferences',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/preferences`;
  const token=new URL(musicianEmailPreferencesUrl('Musician@Example.test')).searchParams.get('token');
  const request=async(body,id,link=token)=>{
    const res=await fetch(`${url}${body===undefined?`?token=${encodeURIComponent(link||'')}`:''}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(id?{Authorization:`Bearer ${jwt.sign({id},process.env.JWT_SECRET)}`}:{})},...(body!==undefined?{body:JSON.stringify({token:link||undefined,...body})}:{})});
    return {status:res.status,data:await res.json()};
  };
  return{records,musicians,token,request,writes:()=>writes};
}

test('preference links are signed, contain no raw email, and cannot be used as account login tokens',async t=>{
 const f=await setup(t),payload=jwt.decode(f.token);
 assert.equal(payload.purpose,'musician_email_preferences');assert.equal(payload.email,undefined);assert.equal(payload.id,undefined);
 assert.equal(verifyMusicianEmailPreferencesToken(f.token),musicianEmailHash('musician@example.test'));
 assert.throws(()=>jwt.verify(f.token,process.env.JWT_SECRET));
 const forged=f.token.slice(0,-8)+'tampered';assert.equal((await f.request(undefined,null,forged)).status,400);assert.equal(f.writes(),0);
});
test('opening a link or a scanner GET never changes preferences or deletes a profile',async t=>{
 const f=await setup(t);const res=await f.request();assert.equal(res.status,200);assert.deepEqual(res.data.preferences,{deputyOpportunities:true,originalsOpportunities:true,profileDeleted:false});assert.equal(f.writes(),0);
});
test('anonymous signed-link unsubscribe choices are independent, persist and can be reversed',async t=>{
 const f=await setup(t);
 assert.equal((await f.request({deputyOpportunities:false,originalsOpportunities:true})).status,200);
 assert.equal(await musicianOpportunityAllowed('MUSICIAN@example.test','deputy'),false);assert.equal(await musicianOpportunityAllowed('musician@example.test','originals'),true);
 assert.equal(await musicianOpportunityAllowed('other@example.test','deputy'),true);
 await f.request({deputyOpportunities:true,originalsOpportunities:false});assert.equal(await musicianOpportunityAllowed('musician@example.test','deputy'),true);assert.equal(await musicianOpportunityAllowed('musician@example.test','originals'),false);
 assert.equal((await f.request()).data.preferences.originalsOpportunities,false);
});
test('preference values must be booleans, rather than accepting injected update fields',async t=>{
 const f=await setup(t);assert.equal((await f.request({deputyOpportunities:'false',originalsOpportunities:true})).status,400);assert.equal(f.writes(),0);
 assert.equal((await f.request({deputyOpportunities:true,originalsOpportunities:true,deleteProfile:'true'})).status,400);assert.equal(f.writes(),0);
});
test('a forwarded unsubscribe link cannot remove a profile without its own authenticated account and explicit confirmation',async t=>{
 const f=await setup(t),body={deputyOpportunities:false,originalsOpportunities:false,deleteProfile:true,confirmation:'DELETE'};
 assert.equal((await f.request(body)).status,401);assert.equal((await f.request(body,other)).status,403);assert.equal((await f.request({...body,confirmation:''},self)).status,400);assert.equal(f.writes(),0);
});
test('confirmed profile removal hides the profile, stops both opportunity lists and retains booking/royalty identity',async t=>{
 const f=await setup(t),body={deputyOpportunities:true,originalsOpportunities:true,deleteProfile:true,confirmation:'DELETE'};
 const res=await f.request(body,self);assert.equal(res.status,200);assert.equal(res.data.preferences.profileDeleted,true);
 const musician=f.musicians.get(self);assert.ok(musician.profileDeletedAt);assert.equal(musician._id,self);assert.equal(musician.email,'musician@example.test');assert.equal(musician.firstName,'Sam');assert.equal(canSeeMusicianInDirectory(musician,{email:'hello@thesupremecollective.co.uk'}),false);
 assert.equal(await musicianOpportunityAllowed(musician.email,'deputy'),false);assert.equal(await musicianOpportunityAllowed(musician.email,'originals'),false);
 const deletedAt=+musician.profileDeletedAt;await f.request(body,self);assert.equal(+musician.profileDeletedAt,deletedAt);
 assert.equal((await f.request({deputyOpportunities:true,originalsOpportunities:true},self)).status,409);
});
test('a signed-in musician can manage their own preferences without an email token',async t=>{
 const f=await setup(t);assert.equal((await f.request(undefined,self,null)).status,200);assert.equal((await f.request(undefined,null,null)).status,401);
});
test('opportunity suppression happens before SMTP while routine project email keeps its preferences link',async t=>{
 const f=await setup(t);await f.request({deputyOpportunities:false,originalsOpportunities:false});
 const skipped=await sendEmail({to:'musician@example.test',subject:'New project',text:'Example',opportunityCategory:'originals'});assert.equal(skipped.ok,true);assert.equal(skipped.reason,'unsubscribed');
 const receipt=buildOriginalSubmissionConfirmationEmail({project:{_id:'project',title:'Test'},submission:{roleName:'Bass'}});
 const preview=await sendEmail({to:'musician@example.test',...receipt,musicianPreferences:true,dryRun:true});
 assert.equal(preview.ok,true);assert.match(preview.mail.html,/Manage email preferences or unsubscribe/);assert.equal((preview.mail.html.match(/data-musician-email-preferences/g)||[]).length,1);assert.match(preview.mail.text,/\/email-preferences\?token=/);assert.doesNotMatch(preview.mail.html,/<!-- musician-email-preferences -->/);
});

test('fallback preferences signing key remains separate from account authentication',async t=>{
 const f=await setup(t);delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
 const link=new URL(musicianEmailPreferencesUrl('musician@example.test')).searchParams.get('token');
 assert.equal(verifyMusicianEmailPreferencesToken(link),musicianEmailHash('musician@example.test'));
 assert.throws(()=>jwt.verify(link,process.env.JWT_SECRET));
 assert.equal((await f.request(undefined,null,link)).status,200);
});
