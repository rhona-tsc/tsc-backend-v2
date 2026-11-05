import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import ChatRead from '../models/originalChatReadModel.js';
import ChatMessage from '../models/originalMessageModel.js';
import { beforeEach } from "node:test";
import Future from "../models/originalRoleReservationModel.js";
beforeEach(t => { t.mock.method(Invitation, "exists", async () => false);  t.mock.method(originalSubmissionCommit, "run", async ({ payload }) => { const saved = await Submission.create(payload); const reservation = await Reservation.findOne({}); reservation.state = "submitted"; await reservation.save(); return saved; });  t.mock.method(Future, "find", () => ({ select: () => ({ lean: async () => [] }), sort: () => ({ lean: async () => [] }) })); });
import test from 'node:test';
import assert from 'node:assert/strict';
import { originalRoleProgress } from '../services/originalsRoleProgressService.js';
import { originalTakeAssetIds, originalTakeKindsValid } from '../services/originalsTakeFilesService.js';
import { allowOriginalReferralRequest, buildOriginalReferralEmail, referralHash, deliverOriginalReferrals } from '../services/originalsReferralService.js';
import { claimOriginalReferral, recommendOriginalMusician, searchOriginalReferralMusicians } from '../controllers/originalsReferralController.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Musician from '../models/musicianModel.js';
import Referral from '../models/originalReferralModel.js';
import Asset from '../models/originalAssetModel.js';
import Event from '../models/originalEventModel.js';
import { submitOriginalTakes } from '../controllers/originalsWorkflowController.js';
const owner='111111111111111111111111',player='222222222222222222222222',projectId='333333333333333333333333';
const project={_id:projectId,title:'Original song',ownerId:owner,ownerName:'Veronica Downie',currentRoundId:'round',state:'foundation_open',requestedRoles:[{name:'Vocal'},{name:'Keys'},{name:'Bass'},{name:'Drums'}]};
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function setup(t,submissions=[]){
  t.mock.method(Project,'findById',()=>({lean:async()=>project}));
  for(const [Model,records]of [[Round,[{_id:'round',type:'foundation',eligibleRoles:['Vocal','Keys','Bass'],state:'open'}]],[Reservation,[]],[Submission,submissions],[Invitation,[]]])t.mock.method(Model,'find',()=>({select:()=>({lean:async()=>records})}));
  t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({firstName:'Veronica',lastName:'Downie',email:'owner@example.test'})})}));
}
test('role statuses distinguish accepted, pending, reserved and unstarted roles without exposing identities',()=>{
 const result=originalRoleProgress({project,rounds:[{_id:'round',type:'foundation',eligibleRoles:['Vocal','Keys','Bass'],state:'open'}],submissions:[{roleName:'Vocal',state:'accepted'},{roleName:'Keys',roundId:'round',state:'submitted'}],reservations:[{roleName:'Bass',roundId:'round',state:'active',expiresAt:new Date(Date.now()+60000)}]});
 assert.deepEqual(result.map(item=>item.status),['Recording approved','Submitted — awaiting review','Reserved — awaiting recording','Awaiting a future round']);
 assert.equal(result[0].canRecommend,false);assert.ok(result.every(item=>!('musicianId'in item)));
});
test('optional effects recording is a distinct, validated stem and does not replace the listening mix',()=>{
 const take={stemAssetId:'clean',mixdownAssetId:'mix',wetStemAssetId:'wet'};
 const assets=[{_id:'clean',kind:'take_stem'},{_id:'mix',kind:'take_mixdown'},{_id:'wet',kind:'take_stem'}];
 assert.deepEqual(originalTakeAssetIds([take]),['clean','mix','wet']);assert.equal(originalTakeKindsValid([take],assets),true);
 assert.equal(originalTakeKindsValid([{...take,wetStemAssetId:'clean'}],assets),false);
 assert.equal(originalTakeKindsValid([{...take,wetStemAssetId:'mix'}],assets),false);
 assert.equal(originalTakeKindsValid([{stemAssetId:'clean',mixdownAssetId:'mix'}],assets),true);
});
test('recommendation search returns public profile details without email or phone',async t=>{
 t.mock.method(Musician,'find',()=>({select:()=>({sort:()=>({skip:()=>({limit:()=>({lean:async()=>[{_id:player,firstName:'John',lastName:'Smith',email:'private@example.test',phone:'private',instrument:'Bass'}]})})})})}));
 const res=response();await searchOriginalReferralMusicians({query:{q:'John Smith'}},res);
 assert.deepEqual(res.body.musicians,[{_id:player,displayName:'John S.',profilePhoto:'',instruments:['Bass'],genres:[],profilePath:`/musician/${player}`}]);
});
test('new contacts are saved with their referral, with a validated role and no account created for them',async t=>{
 setup(t);t.mock.method(Referral,'findOne',async()=>null);t.mock.method(Referral,'countDocuments',async()=>0);
 t.mock.method(Referral,'findOneAndUpdate',()=>({lean:async()=>null}));let saved;
 t.mock.method(Referral,'create',async record=>{saved=record;return{_id:'referral',...record};});
 const res=response();await recommendOriginalMusician({params:{id:projectId},user:{id:owner},body:{roleName:'Bass',fullName:'New Musician',email:'NEW@example.test',phone:'07123456789'}},res);
 assert.equal(res.code,201);assert.equal(saved.email,'new@example.test');assert.equal(saved.phone,'07123456789');assert.equal(saved.referrerName,'Veronica D.');assert.equal(saved.roleName,'Bass');
});
test('recommendations cannot target an already filled role or omit a valid contact',async t=>{
 setup(t,[{roleName:'Bass',state:'accepted'}]);
 const res=response();await recommendOriginalMusician({params:{id:projectId},user:{id:owner},body:{roleName:'Bass'}},res);assert.equal(res.code,409);
 const invalid=response();await recommendOriginalMusician({params:{id:projectId},user:{id:owner},body:{roleName:'Keys',fullName:'New Musician',email:'invalid',phone:'1'}},invalid);assert.equal(invalid.code,400);
});
test('an invitation claim requires both the secret link and the intended signed-in email',async t=>{
 t.mock.method(Referral,'exists',async()=>false);
 t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({email:'wrong@example.test'})})}));
 t.mock.method(Referral,'findOne',async query=>{assert.equal(query.email,'wrong@example.test');assert.equal(query.tokenHash,referralHash('a'.repeat(64)));return null;});
 const res=response();await claimOriginalReferral({params:{id:projectId},user:{id:player},body:{token:'a'.repeat(64)}},res);assert.equal(res.code,403);
});
test('claimed project access is scoped to its project, not the full Originals preview',async t=>{
 t.mock.method(Referral,'find',query=>({select:()=>({lean:async()=>query.projectId===projectId?[{roleName:'Bass'}]:[]})}));
 const req={path:`/projects/${projectId}/workspace`,method:'GET',user:{id:player}};assert.equal(await allowOriginalReferralRequest(req),true);assert.deepEqual(req.originalReferralRoles,['Bass']);
 assert.equal(await allowOriginalReferralRequest({...req,path:'/projects/444444444444444444444444/workspace'}),false);
 assert.equal(await allowOriginalReferralRequest({...req,path:'/moderation'}),false);
});
test('recommendation emails explain the role and have a project-specific secret link with escaped HTML',()=>{
 const mail=buildOriginalReferralEmail({project,referral:{fullName:'<Sam>',referrerName:'Veronica D.',roleName:'Bass',email:'sam@example.test'},token:'secret'});
 assert.match(mail.text,/role of “Bass”/);assert.match(mail.text,/referral=secret/);assert.match(mail.html,/&lt;Sam&gt;/);assert.doesNotMatch(mail.html,/<Sam>/);
});
test('referral delivery stores a token hash, sends the email and does not expose the raw token to API clients',async t=>{
 setup(t);let claimed=false;const updates=[];let email;
 t.mock.method(Referral,'findOneAndUpdate',()=>({lean:async()=>claimed?null:(claimed=true,{_id:'referral',projectId,referrerId:owner,referrerName:'Veronica D.',roleName:'Bass',fullName:'Sam Smith',email:'sam@example.test',expiresAt:new Date(Date.now()+86400000),attempts:1})}));
 t.mock.method(Referral,'updateOne',async(_query,update)=>updates.push(update.$set));
 await deliverOriginalReferrals({emailSender:async mail=>{email=mail;return{ok:true};}});
 const token=email.text.match(/referral=([a-f\d]+)/)[1];assert.equal(token.length,64);assert.equal(updates[0].tokenHash,referralHash(token));assert.equal(updates.at(-1).emailState,'sent');
});

test('take submission validates ownership of all three files and saves the optional effects reference',async t=>{
 t.mock.method(Round,'findById',()=>({lean:async()=>({_id:'round',projectId,type:'instrument',state:'open'})}));
 const stem='444444444444444444444444',mix='555555555555555555555555',wet='666666666666666666666666',booking='777777777777777777777777';
 t.mock.method(Reservation,'findOne',async()=>({_id:booking,projectId,roundId:'round',musicianId:player,roleName:'Vocal',save:async()=>{}}));
 let ids,saved;
 t.mock.method(Asset,'find',query=>{assert.equal(query.ownerId,player);assert.equal(query.reservationId,booking);ids=query._id.$in;return{lean:async()=>[{_id:stem,kind:'take_stem'},{_id:mix,kind:'take_mixdown'},{_id:wet,kind:'take_stem'}]};});
 t.mock.method(Submission,'create',async record=>{saved=record;return{_id:'submission',...record};});
 t.mock.method(Event,'create',async()=>({}));
 const res=response();await submitOriginalTakes({params:{reservationId:booking},user:{id:player},body:{songwritingChoice:'songwriting_claim',takes:[{stemAssetId:stem,mixdownAssetId:mix,wetStemAssetId:wet}]}},res);
 assert.equal(res.code,201);assert.deepEqual(ids,[stem,mix,wet]);assert.equal(saved.takes[0].wetStemAssetId,wet);assert.equal(saved.songwritingChoice,'songwriting_claim');
});

test('three individual stem/mix pairs remain separate review options after submission',async t=>{
 t.mock.method(Round,'findById',()=>({lean:async()=>({_id:'round',projectId,type:'instrument',state:'open'})}));
 const stems=['444444444444444444444441','444444444444444444444442','444444444444444444444443'];
 const mixes=['555555555555555555555551','555555555555555555555552','555555555555555555555553'];
 const booking='777777777777777777777777';let saved,reservationSaved=0;
 t.mock.method(Reservation,'findOne',async()=>({_id:booking,projectId,roundId:'round',musicianId:player,roleName:'Vocal',save:async()=>{reservationSaved++;}}));
 t.mock.method(Asset,'find',query=>{assert.equal(query.ownerId,player);assert.equal(query.reservationId,booking);assert.equal(query.state,'active');assert.deepEqual(new Set(query._id.$in),new Set([...stems,...mixes]));return{lean:async()=>[...stems.map(_id=>({_id,kind:'take_stem'})),...mixes.map(_id=>({_id,kind:'take_mixdown'}))]};});
 t.mock.method(Submission,'create',async record=>{saved=record;return{_id:'submission',...record};});t.mock.method(Event,'create',async()=>({}));
 const takes=stems.map((stemAssetId,index)=>({label:`Vocal option ${index+1}`,stemAssetId,stemAssetIds:[stemAssetId],mixdownAssetId:mixes[index]}));
 const res=response();await submitOriginalTakes({params:{reservationId:booking},user:{id:player},body:{songwritingChoice:'master_only',takes}},res);
 assert.equal(res.code,201);assert.equal(reservationSaved,1);assert.equal(saved.takes.length,3);
 assert.deepEqual(saved.takes.map(take=>[take.stemAssetIds,take.mixdownAssetId]),stems.map((id,index)=>[[id],mixes[index]]));
 assert.equal(saved.takes[1].label,'Vocal option 2');
});

test('real API invitation flow grants only its project and still revokes access after rejection',async t=>{
 const {default:express}=await import('express');const {default:jwt}=await import('jsonwebtoken');const {default:router}=await import('../routes/originalsRoutes.js');
 setup(t);let claimed=false,removed=false;
 t.mock.method(Project,'exists',async()=>true);t.mock.method(ChatRead,'findOne',()=>({select:()=>({lean:async()=>null})}));let readWrites=0;t.mock.method(ChatRead,'updateOne',async query=>{assert.equal(query.musicianId,player);readWrites++;});t.mock.method(ChatMessage,'countDocuments',async()=>2);t.mock.method(ChatMessage,'findOne',query=>({select:()=>({lean:async()=>({_id:query._id,createdAt:new Date('2026-11-04T20:00:00Z')})})}));
 t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({email:'outside@example.test'})})}));
 t.mock.method(Submission,'find',()=>({select:()=>({lean:async()=>removed?[{musicianId:player,roundId:'round',roleName:'Keys',state:'rejected'}]:[]})}));
 t.mock.method(Referral,'exists',async query=>query.tokenHash?query.email==='outside@example.test'&&query.tokenHash===referralHash('a'.repeat(64)):claimed);
 t.mock.method(Referral,'findOne',async query=>query.tokenHash===referralHash('a'.repeat(64))?{_id:'referral',projectId,roleName:'Keys'}:null);
 t.mock.method(Referral,'updateOne',async()=>{claimed=true;});
 t.mock.method(Referral,'find',query=>({select:()=>({lean:async()=>claimed&&(!query.projectId||String(query.projectId)===projectId)?[{projectId,roleName:'Keys'}]:[]})}));
 t.mock.method(Project,'find',()=>({sort:()=>({lean:async()=>[project,{...project,_id:'444444444444444444444444',title:'Other private project'}]})}));
 const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='originals-referral-test-only';t.after(()=>{if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;});t.mock.method(console,'log',()=>{});
 const app=express();app.use(express.json());app.use('/api/originals',router);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const token=jwt.sign({id:player,email:'outside@example.test'},process.env.JWT_SECRET);const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};const url=`http://127.0.0.1:${server.address().port}/api/originals`;
 assert.equal((await fetch(`${url}/projects/${projectId}/access`,{headers})).status,403);
 assert.equal((await fetch(`${url}/projects/${projectId}/referrals/claim`,{method:'POST',headers,body:JSON.stringify({token:'b'.repeat(64)})})).status,403);
 const accepted=await fetch(`${url}/projects/${projectId}/referrals/claim`,{method:'POST',headers,body:JSON.stringify({token:'a'.repeat(64)})});assert.equal(accepted.status,200);assert.equal(claimed,true);
 assert.equal((await fetch(`${url}/projects/${projectId}/access`,{headers})).status,200);
 const unread=await fetch(`${url}/projects/${projectId}/messages/unread`,{headers});assert.equal(unread.status,200);assert.equal((await unread.json()).unreadCount,2);const marked=await fetch(`${url}/projects/${projectId}/messages/read`,{method:'POST',headers,body:JSON.stringify({messageId:'777777777777777777777777',musicianId:owner})});assert.equal(marked.status,200);assert.equal(readWrites,1);
 assert.equal((await fetch(`${url}/projects/444444444444444444444444/access`,{headers})).status,403);
 const board=await(await fetch(`${url}/projects`,{headers})).json();assert.deepEqual(board.projects.map(item=>String(item._id)),[projectId]);
 removed=true;const ended=await fetch(`${url}/projects/${projectId}/access`,{headers});assert.equal(ended.status,403);assert.equal((await ended.json()).code,'ORIGINALS_PARTICIPATION_ENDED');
 assert.equal((await fetch(`${url}/projects/${projectId}/messages/unread`,{headers})).status,403);assert.equal((await fetch(`${url}/projects/${projectId}/messages/read`,{method:'POST',headers,body:JSON.stringify({messageId:'777777777777777777777777'})})).status,403);assert.equal(readWrites,1);
});
