import { beforeEach } from "node:test";
import Future from "../models/originalRoleReservationModel.js";
beforeEach(t => { t.mock.method(Future, "find", () => ({ select: () => ({ lean: async () => [] }), sort: () => ({ lean: async () => [] }) })); });
import test from 'node:test';
import assert from 'node:assert/strict';
import { originalParticipation, originalChatRecipients, requireOriginalParticipation } from '../services/originalsMembershipService.js';
import { queueOriginalChatNotifications, deliverOriginalChatNotifications } from '../services/originalsChatNotificationService.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Notification from '../models/originalNotificationModel.js';
import Musician from '../models/musicianModel.js';
import Message from '../models/originalMessageModel.js';
const owner='111111111111111111111111', player='222222222222222222222222', projectId='333333333333333333333333';
const now = new Date('2026-11-04T16:00:00Z');
const project = { _id: projectId, title: 'Test project', ownerId: owner, currentRoundId: 'current' };
const snapshot = (extra = {}) => ({ project, rounds: [{ _id: 'old', state: 'closed' }, { _id: 'current', state: 'open' }], reservations: [], submissions: [], invitations: [], ...extra });
const sub = extra => ({ musicianId: player, roundId: 'old', roleName: 'Keys', state: 'submitted', reservationId: 'booking', ...extra });
const booking = extra => ({ _id: 'booking', musicianId: player, roundId: 'current', roleName: 'Keys', state: 'active', expiresAt: new Date('2026-11-05'), ...extra });
const response = () => ({ code: 200, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
function mockSnapshot(t, value) {
  t.mock.method(Message,'updateOne',async()=>({}));
  t.mock.method(Message,'find',()=>({sort:()=>({limit:()=>({lean:async()=>[]})})}));
  t.mock.method(Project, 'findById', () => ({ lean: async () => value.project }));
  for (const [Model, field] of [[Round,'rounds'], [Reservation,'reservations'], [Submission,'submissions'], [Invitation,'invitations']]) {
    t.mock.method(Model, 'find', () => ({ select: () => ({ lean: async () => value[field] }) }));
  }
}
test('round advancement removes unselected pending entrants despite stale submitted reservations', () => {
  const value=snapshot({submissions:[sub()],reservations:[booking({roundId:'old',state:'submitted'})]});
  assert.deepEqual(originalParticipation(value,player,now),{canAccess:false,notify:false,blockedRoles:['keys']});
});
test('review is pending selection, while a rejection ends access immediately', () => {
  const pending=snapshot({rounds:[{_id:'current',state:'review'}],submissions:[sub({roundId:'current'})]});
  assert.equal(originalParticipation(pending,player,now).notify,true);
  pending.submissions[0].state='rejected';
  assert.equal(originalParticipation(pending,player,now).canAccess,false);
});
test('accepted musicians remain, including when a different role was rejected', () => {
  const value=snapshot({submissions:[sub({state:'rejected'}),sub({state:'accepted',roleName:'Bass'})]});
  const result=originalParticipation(value,player,now);
  assert.equal(result.canAccess,true);assert.equal(result.notify,true);assert.deepEqual(result.blockedRoles,['keys']);
});
test('a different current active role retains access, but stale or expired reservations do not notify', () => {
  for (const extra of [{roundId:'old'},{expiresAt:new Date('2026-11-01')}]) assert.equal(originalParticipation(snapshot({reservations:[booking(extra)]}),player,now).notify,false);
  const active=snapshot({submissions:[sub({state:'rejected'})],reservations:[booking({_id:'other-booking',roleName:'Bass'})]});
  assert.equal(originalParticipation(active,player,now).notify,true);
  active.reservations[0].roleName='Keys';assert.equal(originalParticipation(active,player,now).canAccess,false);
});
test('prospective viewers can inspect projects but are not chat notification recipients', () => {
  assert.equal(originalParticipation(snapshot(),player,now).canAccess,true);
  assert.deepEqual(originalChatRecipients(snapshot(),player,now),[owner]);
  assert.deepEqual(originalChatRecipients(snapshot(),owner,now),[]);
});
test('an old invitation does not rescue a loser; a fresh invitation to a new round can restore their role', () => {
  const value=snapshot({submissions:[sub({state:'rejected'})],invitations:[{invitedMusicianId:player,roundId:'old',roleName:'Keys',state:'pending'}]});
  assert.equal(originalParticipation(value,player,now).canAccess,false);
  value.invitations.push({invitedMusicianId:player,roundId:'current',roleName:'Keys',state:'pending'});
  assert.equal(originalParticipation(value,player,now).canAccess,true);
  assert.deepEqual(originalParticipation(value,player,now).blockedRoles,[]);
  assert.equal(originalParticipation(value,player,now).notify,false);
});
test('middleware rejects a former participant before allowing any project action, owner still has access', async t=>{
  mockSnapshot(t,snapshot({submissions:[sub({state:'rejected'})]}));
  const res=response();let calls=0;
  await requireOriginalParticipation({params:{id:projectId},user:{id:player},body:{},path:'/messages'},res,()=>calls++);
  assert.equal(res.code,403);assert.equal(res.body.code,'ORIGINALS_PARTICIPATION_ENDED');assert.equal(calls,0);
  await requireOriginalParticipation({params:{id:projectId},user:{id:owner},body:{},path:'/messages'},response(),()=>calls++);
  assert.equal(calls,1);
});
test('one retained role cannot be used to re-reserve a different rejected role', async t=>{
  mockSnapshot(t,snapshot({submissions:[sub({state:'rejected'}),sub({state:'accepted',roleName:'Bass'})]}));
  t.mock.method(Round,'findById',()=>({select:()=>({lean:async()=>({projectId,roleName:'Keys'})})}));
  const res=response();await requireOriginalParticipation({params:{roundId:'current'},user:{id:player},method:'POST',body:{},path:'/reservations'},res,()=>assert.fail('must deny rejected role'));
  assert.equal(res.body.code,'ORIGINALS_ROLE_ENDED');
});
test('queue targets owner and current/accepted members once, omitting sender and unselected entrants', async t=>{
  const other='444444444444444444444444';
  mockSnapshot(t,snapshot({submissions:[sub({state:'rejected'}),sub({musicianId:other,state:'accepted'})],reservations:[booking({musicianId:other})]}));
  let writes;
  t.mock.method(Notification,'bulkWrite',async ops=>{writes=ops;});
  await queueOriginalChatNotifications({project,message:{_id:'message',authorId:other}});
  assert.deepEqual(writes.map(op=>op.updateOne.filter.recipientMusicianId),[owner]);
  assert.deepEqual(writes[0].updateOne.update.$setOnInsert.channels,['email']);
});
function mockJob(t, value, attempts=1) {
  mockSnapshot(t,value);let claimed=false;const updates=[];
  t.mock.method(Notification,'findOneAndUpdate',()=>({lean:async()=>claimed?null:(claimed=true,{_id:'job',projectId,recipientMusicianId:player,attempts})}));
  t.mock.method(Notification,'updateOne',async(query,update)=>{updates.push(update.$set);});
  t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({email:'tscplayer@gmail.com',firstName:'Player'})})}));
  return updates;
}
test('delivery cancels queued notifications after rejection, without sending email',async t=>{
  const updates=mockJob(t,snapshot({submissions:[sub({state:'rejected'})]}));let sent=0;
  const result=await deliverOriginalChatNotifications({emailSender:async()=>{sent++;return{ok:true};},now});
  assert.equal(sent,0);assert.equal(result.cancelled,1);assert.equal(updates[0].state,'cancelled');
});
test('delivery sends eligible members a project link, without copying private chat content into email',async t=>{
  const updates=mockJob(t,snapshot({submissions:[sub({state:'accepted'})]}));let mail;
  const result=await deliverOriginalChatNotifications({emailSender:async email=>{mail=email;return{ok:true};},now});
  assert.equal(result.sent,1);assert.equal(updates[0].state,'sent');assert.equal(mail.to,'tscplayer@gmail.com');assert.match(mail.text,new RegExp(`/originals/${projectId}`));
});
test('email failures retry automatically, then stop after five attempts',async t=>{
  const updates=mockJob(t,snapshot({submissions:[sub({state:'accepted'})]}),5);
  const result=await deliverOriginalChatNotifications({emailSender:async()=>({ok:false,error:'mail unavailable'}),now});
  assert.equal(result.failed,1);assert.equal(updates[0].state,'failed');
});

test('notification outbox recovers a message whose initial queue creation failed', async t=>{
  const value=snapshot({submissions:[sub({state:'accepted'})]});mockSnapshot(t,value);
  t.mock.method(Message,'find',query=>{assert.equal(query.chatNotificationsQueued,false);return{sort:()=>({limit:()=>({lean:async()=>[{_id:'recover-message',projectId,authorId:owner}]})})};});
  const queued=[];let marked=false;
  t.mock.method(Notification,'bulkWrite',async writes=>{queued.push(...writes);});
  t.mock.method(Message,'updateOne',async(_query,update)=>{marked=update.$set.chatNotificationsQueued;});
  t.mock.method(Notification,'findOneAndUpdate',()=>({lean:async()=>null}));
  await deliverOriginalChatNotifications({emailSender:()=>assert.fail('no claimed jobs'),now});
  assert.equal(marked,true);assert.deepEqual(queued.map(op=>op.updateOne.filter.recipientMusicianId),[player]);
});

test('all project routes enforce removal, including chat, uploads, old files, reservations and credits', async t=>{
  const {default:express}=await import('express');const {default:jwt}=await import('jsonwebtoken');
  const {default:router}=await import('../routes/originalsRoutes.js');
  const {default:Asset}=await import('../models/originalAssetModel.js');
  const {default:Credit}=await import('../models/originalCreditVersionModel.js');
  const {default:Issue}=await import('../models/originalIssueModel.js');
  mockSnapshot(t,snapshot({submissions:[sub({state:'rejected'})]}));
  for(const Model of [Round,Reservation,Submission,Asset,Credit,Issue]) t.mock.method(Model,'findById',()=>({select:()=>({lean:async()=>({projectId})})}));
  const previous=process.env.JWT_SECRET;process.env.JWT_SECRET='originals-test-only';t.after(()=>{if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;});
  t.mock.method(console,'log',()=>{});
  const app=express();app.use(express.json());app.use('/api/originals',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const token=jwt.sign({id:player,email:'tscparticipant@gmail.com'},process.env.JWT_SECRET);
  for(const[method,path]of [['GET',`projects/${projectId}/workspace`],['GET',`projects/${projectId}/messages`],['GET',`projects/${projectId}/access`],['POST',`projects/${projectId}/messages`],['POST',`projects/${projectId}/assets`],['GET','assets/asset/access'],['POST','rounds/round/reservations'],['POST','reservations/booking/submissions'],['POST','submissions/submission/replace'],['POST','credit-versions/credit/confirm'],['POST','issues/issue']]){
    const result=await fetch(`http://127.0.0.1:${server.address().port}/api/originals/${path}`,{method,headers:{Authorization:`Bearer ${token}`}});
    assert.equal(result.status,403,path);assert.equal((await result.json()).code,'ORIGINALS_PARTICIPATION_ENDED',path);
  }
});

test('temporary email failure is queued for retry instead of failing the chat',async t=>{
  const updates=mockJob(t,snapshot({submissions:[sub({state:'accepted'})]}));
  const result=await deliverOriginalChatNotifications({emailSender:async()=>({ok:false,error:'temporary error'}),now});
  assert.equal(result.failed,1);assert.equal(updates[0].state,'queued');assert.equal(updates[0].sendAfter-now,5*60*1000);
});

test('a concern retains an approved contributor but cannot preserve an unselected pending take',()=>{
  const approved=snapshot({submissions:[sub({state:'retraction_requested',selectionMode:'whole_take'})]});
  assert.equal(originalParticipation(approved,player,now).notify,true);
  approved.submissions[0].selectionMode='';
  assert.equal(originalParticipation(approved,player,now).canAccess,false);
});
