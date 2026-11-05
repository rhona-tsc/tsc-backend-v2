import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { deliverOriginalReservationReminders, buildOriginalReservationReminderEmail } from '../services/originalsReservationReminderService.js';
import { runOriginalsAutomation } from '../services/originalsAutomationService.js';
import Notification from '../models/originalNotificationModel.js';
const projectId='111111111111111111111111',owner='222222222222222222222222',player='333333333333333333333333',roundId='444444444444444444444444',reservationId='555555555555555555555555';
const now=new Date('2026-11-05T12:00:00Z'),enabled={ORIGINALS_AUTOMATION_ENABLED:'true'};
function setup(t,hours=6) {
 const expiresAt=new Date(+now+(hours===12?8:hours===6?3:0.5)*3600000);
 return originalsTransactionStore(t,{
  projects:[{_id:projectId,title:'Original song',ownerId:owner,state:'foundation_open',currentRoundId:roundId}],
  rounds:[{_id:roundId,projectId,type:'foundation',eligibleRoles:['Vocal'],state:'open',slotLimit:3,clockStartedAt:now,closesAt:new Date(+now+3*86400000)}],
  reservations:[{_id:reservationId,projectId,roundId,musicianId:player,roleName:'Vocal',state:'active',expiresAt,remindersSent:{}}],
  musicians:[{_id:player,email:'musician@example.test',firstName:'Sam'}],
  notifications:[{_id:'job',projectId,recipientMusicianId:player,eventKey:`reservation:${reservationId}:reminder:${hours}`,template:'originals_reservation_reminder',payload:{reservationId,hours,expiresAt:expiresAt.toISOString()},state:'queued',sendAfter:now,attempts:0}],
 });
}
const deliver=(options={})=>deliverOriginalReservationReminders({now,env:enabled,...options});

test('all 12-, 6- and 1-hour reminders send to the musician with a hidden monitoring copy',async t=>{
 const s=setup(t);const sent=[];
 for(const hours of [12,6,1]) {
  const reservation=s.data.reservations[0];reservation.expiresAt=new Date(+now+(hours===12?8:hours===6?3:0.5)*3600000);
  s.data.notifications=[{_id:'job'+hours,projectId,recipientMusicianId:player,template:'originals_reservation_reminder',payload:{reservationId,hours},state:'queued',sendAfter:now,attempts:0}];
  await deliver({emailSender:async mail=>{sent.push(mail);return{ok:true};}});
  assert.equal(s.data.notifications[0].state,'sent');
 }
 assert.equal(sent.length,3);assert.ok(sent.every(mail=>mail.to==='musician@example.test'&&mail.bcc==='hello@thesupremecollective.co.uk'&&!mail.cc));
 assert.ok(sent.every(mail=>!mail.text.includes('bcc')&&!mail.html.includes('bcc')));
 assert.match(sent[2].subject,/within 1 hour —/);assert.match(sent[0].text,/#submit-take/);
});
test('turning off BCC keeps the musician reminder and self-addressed monitoring does not duplicate recipients',async t=>{
 const s=setup(t);let mail;
 await deliver({env:{...enabled,ORIGINALS_RESERVATION_REMINDER_BCC_ENABLED:'false'},emailSender:async m=>{mail=m;return{ok:true};}});
 assert.equal(mail.to,'musician@example.test');assert.equal(mail.bcc,undefined);
 s.data.notifications[0].state='queued';s.data.musicians[0].email='HELLO@thesupremecollective.co.uk';
 await deliver({emailSender:async m=>{mail=m;return{ok:true};}});assert.equal(mail.bcc,undefined);
});
test('existing automation and Originals switches remain in control',async t=>{
 const s=setup(t);
 for(const env of [{},{ORIGINALS_AUTOMATION_ENABLED:'false'},{...enabled,ORIGINALS_ENABLED:'false'}])await deliver({env,emailSender:()=>assert.fail('disabled')});
 assert.equal(s.data.notifications[0].state,'queued');assert.equal(s.data.notifications[0].attempts,0);
});
test('submitting, releasing, cancellation, expiry and closed rounds cancel old reminders',async t=>{
 const s=setup(t);const baseline=structuredClone(s.data);
 const reset=()=>{for(const key of Object.keys(s.data))s.data[key]=structuredClone(baseline[key]);};
 const changes=[
  ()=>s.data.reservations[0].state='submitted',()=>s.data.reservations[0].state='released',()=>s.data.reservations[0].state='cancelled',
  ()=>s.data.reservations[0].expiresAt=new Date(+now-1),()=>s.data.rounds[0].state='closed',()=>s.data.rounds[0].state='review',
  ()=>s.data.projects=[],()=>s.data.projects[0].state='paused',()=>s.data.projects[0].currentRoundId='next',
  ()=>s.data.submissions.push({_id:'submission',projectId,reservationId,musicianId:player,roundId,state:'submitted'}),
 ];
 for(const change of changes){reset();change();await deliver({emailSender:()=>assert.fail('stale reminder')});assert.equal(s.data.notifications[0].state,'cancelled');}
});
test('extensions, stale reminder bands and mismatched recipient/project IDs are not emailed',async t=>{
 const s=setup(t),baseline=structuredClone(s.data);
 for(const change of [()=>s.data.reservations[0].expiresAt=new Date(+now+20*3600000),()=>s.data.reservations[0].expiresAt=new Date(+now+4*3600000),()=>s.data.notifications[0].payload.hours=12,()=>s.data.reservations[0].musicianId=owner,()=>s.data.rounds[0].projectId='other',()=>s.data.rounds[0].eligibleRoles=['Bass']]){
  for(const key of Object.keys(s.data))s.data[key]=structuredClone(baseline[key]);change();await deliver({emailSender:()=>assert.fail('invalid reminder')});assert.equal(s.data.notifications[0].state,'cancelled');
 }
});
test('SMTP retry retains BCC and a sent reminder is not sent again',async t=>{
 const s=setup(t);let attempts=0;
 await deliver({emailSender:async mail=>{attempts++;assert.equal(mail.bcc,'hello@thesupremecollective.co.uk');return{ok:false,error:'offline'};}});
 assert.equal(s.data.notifications[0].state,'queued');assert.equal(s.data.notifications[0].attempts,1);
 await deliver({now:new Date(+now+300000),emailSender:async mail=>{attempts++;assert.equal(mail.bcc,'hello@thesupremecollective.co.uk');return{ok:true};}});
 assert.equal(s.data.notifications[0].state,'sent');assert.equal(attempts,2);
 await deliver({now:new Date(+now+600000),emailSender:()=>assert.fail('duplicate')});
});
test('failed SMTP jobs stop after five attempts and abandoned leases can be reclaimed',async t=>{
 const s=setup(t);s.data.notifications[0].state='sending';s.data.notifications[0].leaseExpiresAt=new Date(+now-1);s.data.notifications[0].attempts=4;
 await deliver({emailSender:async()=>({ok:false,error:'offline'})});assert.equal(s.data.notifications[0].state,'failed');assert.equal(s.data.notifications[0].attempts,5);
});
test('automation queues an email reminder and delivery includes the monitor BCC once',async t=>{
 const s=setup(t);s.data.notifications=[];
 const create=Notification.create;t.mock.method(Notification,'create',value=>create({...value,sendAfter:now,attempts:0}));
 const result=await runOriginalsAutomation({now});assert.equal(result.remindersQueued,1);assert.equal(s.data.reservations[0].remindersSent.sixHour,true);
 assert.deepEqual(s.data.notifications[0].channels,['email']);assert.equal(s.data.notifications[0].payload.expiresAt,s.data.reservations[0].expiresAt.toISOString());
 const sent=[];await deliver({emailSender:async mail=>{sent.push(mail);return{ok:true};}});assert.equal(sent.length,1);assert.equal(sent[0].bcc,'hello@thesupremecollective.co.uk');
 await runOriginalsAutomation({now});await deliver({emailSender:()=>assert.fail('already sent')});
});
test('queue failure does not consume a reminder before it is durably queued',async t=>{
 const s=setup(t);s.data.notifications=[];t.mock.method(Notification,'create',async()=>{throw new Error('queue offline');});
 await assert.rejects(runOriginalsAutomation({now}),/queue offline/);assert.equal(s.data.reservations[0].remindersSent.sixHour,undefined);
});
test('email uses actual UK deadline, escapes content and distinguishes production outputs',()=>{
 const base={project:{_id:projectId,title:'<Song>'},reservation:{roleName:'<Vocal>',expiresAt:new Date('2026-11-05T15:00:00Z')},firstName:'<Sam>',hours:6};
 const mail=buildOriginalReservationReminderEmail(base);assert.match(mail.text,/15:00:00 GMT \(UK time\)/);assert.match(mail.html,/&lt;Song&gt;/);assert.doesNotMatch(mail.html,/<Vocal>|<Sam>/);assert.match(mail.text,/unless approved/);
 const mix=buildOriginalReservationReminderEmail({...base,round:{type:'mix'}});assert.match(mix.text,/your mix output/);assert.match(mix.text,/Submit mix output/);assert.doesNotMatch(mix.text,/#submit-take/);
});
