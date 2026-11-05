import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { deliverOriginalRoundLifecycleNotifications, buildOriginalPrivateInvitationEmail } from '../services/originalsRoundLifecycleNotificationService.js';
import { allowOriginalInvitationRequest } from '../services/originalsInvitationAccessService.js';
import Notification from '../models/originalNotificationModel.js';
const projectId='111111111111111111111111',owner='222222222222222222222222',selected='333333333333333333333333',other='444444444444444444444444',second='555555555555555555555555',old='666666666666666666666666',current='777777777777777777777777';
const now=new Date('2026-11-05T16:00:00Z');
function setup(t) {return originalsTransactionStore(t,{
 projects:[{_id:projectId,title:'New original',ownerId:owner,currentRoundId:current,state:'role_round_open'}],
 rounds:[{_id:old,projectId,type:'foundation',state:'closed',closeReason:'next_round_opened',closedAt:now,closureNotificationsPending:true},{_id:current,projectId,type:'instrument',roleName:'Vocal',state:'open'}],
 reservations:[{_id:'winner',roundId:old,projectId,musicianId:selected,roleName:'Click',state:'submitted'},{_id:'one',roundId:old,projectId,musicianId:other,roleName:'Click',state:'cancelled',endedByRoundAdvance:true,roundAdvanceClosedAt:now},{_id:'two',roundId:old,projectId,musicianId:second,roleName:'Click',state:'cancelled',endedByRoundAdvance:true,roundAdvanceClosedAt:now}],
 submissions:[{_id:'winner-take',roundId:old,projectId,musicianId:selected,reservationId:'winner',roleName:'Click',state:'accepted'}],
 musicians:[{_id:selected,email:'selected@example.test',firstName:'Selected'},{_id:other,email:'other@example.test',firstName:'Other'},{_id:second,email:'second@example.test',firstName:'Second'}],
 });}

test('round closure emails each unselected reserved musician once, including someone who has not submitted',async t=>{
 const s=setup(t),sent=[];await deliverOriginalRoundLifecycleNotifications({now,emailSender:async mail=>{sent.push(mail);return{ok:true};}});
 assert.deepEqual(sent.map(mail=>mail.to).sort(),['other@example.test','second@example.test']);assert.ok(sent.every(mail=>/stop recording/.test(mail.text)));assert.ok(sent.every(mail=>/Any accepted contribution or other role/.test(mail.text)));assert.equal(s.data.rounds[0].closureNotificationsPending,false);
 assert.ok(sent.every(mail=>!mail.bcc&&!mail.cc));
 await deliverOriginalRoundLifecycleNotifications({now,emailSender:()=>assert.fail('no duplicate delivery')});assert.equal(s.data.notifications.length,2);assert.ok(s.data.notifications.every(n=>n.state==='sent'));
});
test('queue failures retain the closure marker, then retry without duplicate recipients',async t=>{
 const s=setup(t);const original=Notification.updateOne;
 t.mock.method(Notification,'updateOne',async()=>{throw new Error('Queue offline');});await assert.rejects(deliverOriginalRoundLifecycleNotifications({now,emailSender:()=>assert.fail('not queued')}),/Queue offline/);assert.equal(s.data.rounds[0].closureNotificationsPending,true);
 t.mock.method(Notification,'updateOne',original);let sent=0;await deliverOriginalRoundLifecycleNotifications({now,emailSender:async()=>{sent++;return{ok:true};}});assert.equal(sent,2);
});
test('SMTP failures retry, while reopening the old round cancels stale closure emails',async t=>{
 const s=setup(t);await deliverOriginalRoundLifecycleNotifications({now,emailSender:async()=>({ok:false,error:'temporary failure'})});assert.ok(s.data.notifications.every(n=>n.state==='queued'));
 s.data.rounds[0].state='reopened';await deliverOriginalRoundLifecycleNotifications({now:new Date(+now+300000),emailSender:()=>assert.fail('round reopened')});assert.ok(s.data.notifications.every(n=>n.state==='cancelled'));
});
test('a new private invitation emails its intended account and grants only that project',async t=>{
 const s=setup(t);s.data.rounds[0].closureNotificationsPending=false;s.data.invitations.push({_id:'invite',projectId,roundId:current,invitedMusicianId:other,roleName:'Vocal',state:'pending',emailPending:true,createdAt:now,message:'Please try a harmony.'});
 let mail;await deliverOriginalRoundLifecycleNotifications({now,emailSender:async message=>{mail=message;return{ok:true};}});assert.equal(mail.to,'other@example.test');assert.match(mail.subject,/Vocal/);assert.match(mail.text,/does not reserve a slot/);assert.equal(s.data.invitations[0].emailPending,false);
 assert.equal(mail.bcc,'hello@thesupremecollective.co.uk');assert.equal(mail.cc,undefined);assert.doesNotMatch(mail.html,/bcc|hello@thesupremecollective.co.uk/i);
 assert.equal(await allowOriginalInvitationRequest({path:`/projects/${projectId}/workspace`,user:{id:other}},now),true);
 assert.equal(await allowOriginalInvitationRequest({path:`/projects/${'a'.repeat(24)}/workspace`,user:{id:other}},now),false);
 assert.equal(await allowOriginalInvitationRequest({path:'/moderation',user:{id:other}},now),false);
 s.data.invitations[0].state='cancelled';assert.equal(await allowOriginalInvitationRequest({path:`/projects/${projectId}/workspace`,user:{id:other}},now),false);
});
test('expired, wrong-role and previous-round invitations are not emailed',async t=>{
 const s=setup(t);s.data.rounds[0].closureNotificationsPending=false;
 for(const[roleName,roundId,expiresAt]of[['Click',current,null],['Vocal',old,null],['Vocal',current,new Date(+now-1)]]){
  s.data.invitations=[{_id:'invite'+s.data.notifications.length,projectId,roundId,invitedMusicianId:other,roleName,state:'pending',emailPending:true,expiresAt,createdAt:now}];
  await deliverOriginalRoundLifecycleNotifications({now,emailSender:()=>assert.fail('invalid invitation')});
 }
 assert.ok(s.data.notifications.every(n=>n.state==='cancelled'));
});
test('invitation message is escaped and retains the project and role link',()=>{
 const message=buildOriginalPrivateInvitationEmail({project:{_id:projectId,title:'<Song>'},invitation:{roleName:'<Vocal>',message:'<script>bad</script>\nA second line.'},firstName:'<Rhona>'});assert.doesNotMatch(message.html,/<script>|<Song>|<Vocal>|<Rhona>/);assert.match(message.html,/&lt;script&gt;/);assert.match(message.text,/#project-roles/);
 assert.match(message.html,/&lt;Rhona&gt;/);assert.match(message.html,/&lt;Song&gt;/);assert.match(message.html,/&lt;Vocal&gt;/);
 assert.match(message.html,/<br>A second line/);assert.match(message.html,/bgcolor="#ff6667"/);assert.match(message.html,/>Open the project<\/a>/);
 assert.match(message.html,/TSC ORIGINALS/);assert.match(message.html,/TSC_Signature_2026/);assert.match(message.html,/Find us online/);assert.match(message.text,/Company Number: 16883956/);
 const noNote=buildOriginalPrivateInvitationEmail({project:{_id:projectId,title:'Song'},invitation:{roleName:'Piano'}});
 assert.doesNotMatch(noNote.html,/A MESSAGE FOR YOU|undefined/);
});
test('invitation monitoring can be disabled and avoids a duplicate copy to the main recipient',async t=>{
 const s=setup(t);s.data.rounds[0].closureNotificationsPending=false;
 const invite=id=>({_id:id,projectId,roundId:current,invitedMusicianId:other,roleName:'Vocal',state:'pending',emailPending:true,createdAt:now});
 s.data.invitations.push(invite('disabled'));
 const sent=[];const emailSender=async mail=>{sent.push(mail);return{ok:true};};
 await deliverOriginalRoundLifecycleNotifications({now,emailSender,env:{ORIGINALS_INVITATION_BCC_ENABLED:'false'}});
 assert.equal(sent.length,1);assert.equal(sent[0].to,'other@example.test');assert.equal(sent[0].bcc,undefined);
 s.data.musicians.find(m=>m._id===other).email=' Hello@TheSupremeCollective.co.uk ';
 s.data.invitations.push(invite('self'));
 await deliverOriginalRoundLifecycleNotifications({now,emailSender,env:{ORIGINALS_INVITATION_BCC_ENABLED:'true'}});
 assert.equal(sent.length,2);assert.equal(sent[1].bcc,undefined);
});
test('invitation SMTP retries retain the hidden monitoring copy without re-sending a delivered invitation',async t=>{
 const s=setup(t);s.data.rounds[0].closureNotificationsPending=false;
 s.data.invitations.push({_id:'retry',projectId,roundId:current,invitedMusicianId:other,roleName:'Vocal',state:'pending',emailPending:true,createdAt:now});
 let attempts=0;const emailSender=async mail=>{attempts++;assert.equal(mail.bcc,'hello@thesupremecollective.co.uk');return{ok:attempts>1,error:'Temporary SMTP failure'};};
 await deliverOriginalRoundLifecycleNotifications({now,emailSender});assert.equal(s.data.notifications[0].state,'queued');
 await deliverOriginalRoundLifecycleNotifications({now:new Date(+now+300000),emailSender});assert.equal(s.data.notifications[0].state,'sent');
 await deliverOriginalRoundLifecycleNotifications({now:new Date(+now+300000),emailSender});assert.equal(attempts,2);
});
