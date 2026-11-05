import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { originalReviewStatus } from '../services/originalsReviewService.js';
import { getOriginalReviewStatus } from '../controllers/originalsReviewController.js';
import { buildOriginalSubmissionEmail, deliverOriginalProjectEmails } from '../services/originalsProjectEmailService.js';
import { submitOriginalProduction } from '../controllers/originalsWorkflowController.js';
import Project from '../models/originalProjectModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Round from '../models/originalRoundModel.js';
import Asset from '../models/originalAssetModel.js';
import Event from '../models/originalEventModel.js';

const ownerId = '111111111111111111111111', projectId = '222222222222222222222222', musicianId = '333333333333333333333333';
const response = () => ({ code: 200, headers: {}, set(key,value) { this.headers[key]=value; return this; }, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
const now = new Date('2026-11-05T15:00:00Z');
function fixture() {
  const project = { _id: projectId, ownerId, ownerEmail: 'snapshot-owner@example.test', title: '<An original>', state: 'foundation_open', moderation: { status: 'approved' } };
  const submission = { _id: 'take1', projectId, musicianId, roleName: 'Vocal', category: 'contribution', state: 'submitted', revision: 1, ownerNotificationPending: true };
  const jobs = new Map(); let ownerEmail = 'current-owner@example.test';
  const emailRepository = {
    async updateOne(filter, update) {
      if (update.$setOnInsert) { if (!jobs.has(filter.eventKey)) jobs.set(filter.eventKey, { _id: `job${jobs.size}`, attempts: 0, state: 'queued', sendAfter: now, ...update.$setOnInsert }); }
      else { const job = [...jobs.values()].find(item => item._id === filter._id && item.leaseToken === filter.leaseToken && item.state === filter.state); if (job) Object.assign(job, update.$set); }
    },
    findOneAndUpdate(filter, update) { return { lean: async () => {
      const time = filter.$or[0].sendAfter.$lte;
      const job = [...jobs.values()].find(item => item.state === 'queued' && item.sendAfter <= time || item.state === 'sending' && item.leaseExpiresAt <= time);
      if (!job) return null;
      Object.assign(job, update.$set); job.attempts++; return { ...job };
    } }; },
  };
  const projectRepository = { find: () => ({ lean: async () => [] }), findById: () => ({ lean: async () => project }) };
  const musicianRepository = { findById: id => { assert.equal(String(id), ownerId); return { select: () => ({ lean: async () => ({ email: ownerEmail }) }) }; } };
  const submissionRepository = {
    find: () => ({ limit: () => ({ lean: async () => submission.ownerNotificationPending ? [{ ...submission }] : [] }) }),
    findById: () => ({ lean: async () => ({ ...submission }) }),
    async updateOne(filter, update) { if (filter.revision === submission.revision) Object.assign(submission, update.$set); },
  };
  return { project, submission, jobs, emailRepository, projectRepository, musicianRepository, submissionRepository, setEmail(value) { ownerEmail=value; } };
}

test('review badge counts pending submissions across recording, mix and master categories', () => {
  const rows = [{ _id:'b',state:'submitted',revision:2,category:'mix' },{ _id:'a',state:'submitted',category:'contribution' },{ _id:'c',state:'accepted' },{ _id:'d',state:'rejected' },{ _id:'e',state:'withdrawn' },{ _id:'f',state:'submitted',category:'master' }];
  const first = originalReviewStatus(rows);
  assert.equal(first.pendingCount,3); assert.equal(originalReviewStatus([...rows].reverse()).signature,first.signature);
  rows[0].revision++; assert.notEqual(originalReviewStatus(rows).signature,first.signature);
  rows[0].state='accepted'; assert.equal(originalReviewStatus(rows).pendingCount,2);
});
test('review status endpoint is owner/manager only and returns no recordings or identities', async t => {
  t.mock.method(Project,'findById',()=>({lean:async()=>({_id:projectId,ownerId})}));
  let queries=0;
  t.mock.method(Submission,'find',filter=>{queries++;assert.deepEqual(filter,{projectId,state:'submitted'});return{select:()=>({lean:async()=>[{_id:'pending',revision:1,state:'submitted'}]})};});
  let res=response();await getOriginalReviewStatus({params:{id:projectId},user:{id:musicianId}},res);assert.equal(res.code,403);assert.equal(queries,0);
  res=response();await getOriginalReviewStatus({params:{id:projectId},user:{id:ownerId}},res);assert.equal(res.code,200);assert.equal(res.body.pendingCount,1);assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(Object.keys(res.body).sort(),['pendingCount','signature','success']);
});
test('submission mail is escaped, respects anonymous credit and links to review rather than downloads', () => {
  const f=fixture();const message=buildOriginalSubmissionEmail({project:f.project,submission:{...f.submission,anonymous:true,creditName:'<Artist>'}});
  assert.match(message.html,/&lt;Artist&gt;/);assert.match(message.html,/&lt;An original&gt;/);assert.doesNotMatch(message.html,/<Artist>|href="https:\/\/res\.cloudinary/);
  assert.match(message.text,/#project-review/);assert.match(message.subject,/Vocal/);
});
test('worker recovers a saved submission marker, emails only its current owner and does not duplicate', async () => {
  const f=fixture(),sent=[];const emailSender=async mail=>{sent.push(mail);return{ok:true};};
  await deliverOriginalProjectEmails({...f,emailSender,now});await deliverOriginalProjectEmails({...f,emailSender,now});
  assert.equal(sent.length,1);assert.equal(sent[0].to,'current-owner@example.test');assert.equal(f.submission.ownerNotificationPending,false);assert.equal([...f.jobs.values()][0].state,'sent');
});
test('email failure retries without changing the saved take or marking it reviewed', async () => {
  const f=fixture();let attempts=0;
  const emailSender=async()=>({ok:++attempts>1,error:'SMTP temporarily unavailable'});
  await deliverOriginalProjectEmails({...f,emailSender,now});assert.equal(f.submission.state,'submitted');assert.equal([...f.jobs.values()][0].state,'queued');
  await deliverOriginalProjectEmails({...f,emailSender,now:new Date(now.getTime()+300000)});assert.equal(attempts,2);assert.equal([...f.jobs.values()][0].state,'sent');
});
test('a replacement creates one fresh revision alert and cancels a stale queued alert', async () => {
  const f=fixture();await deliverOriginalProjectEmails({...f,emailSender:async()=>({ok:false,error:'retry'}),now});
  f.submission.revision=2;f.submission.ownerNotificationPending=true;
  const sent=[];await deliverOriginalProjectEmails({...f,emailSender:async mail=>{sent.push(mail);return{ok:true};},now:new Date(now.getTime()+300000)});
  assert.equal(f.jobs.size,2);assert.equal([...f.jobs.values()][0].state,'cancelled');assert.equal(sent.length,1);assert.match(sent[0].subject,/Updated/);assert.match(sent[0].text,/Revision 2/);
});
test('already decided, withdrawn and cancelled project submissions do not send stale alerts', async () => {
  for (const state of ['accepted','rejected','withdrawn','cancelled-project']) {
    const f=fixture();await deliverOriginalProjectEmails({...f,emailSender:async()=>({ok:false,error:'retry'}),now});
    if(state==='cancelled-project')f.project.state='cancelled';else f.submission.state=state;
    let sends=0;await deliverOriginalProjectEmails({...f,emailSender:async()=>{sends++;return{ok:true};},now:new Date(now.getTime()+300000)});
    assert.equal(sends,0);assert.equal([...f.jobs.values()][0].state,'cancelled');
  }
});
test('queue failure leaves the saved marker available for a later retry', async t => {
  t.mock.method(console,'error',()=>{});const f=fixture();const update=f.emailRepository.updateOne;
  f.emailRepository.updateOne=async()=>{throw new Error('Queue temporarily unavailable');};
  await deliverOriginalProjectEmails({...f,emailSender:async()=>{throw new Error('No mail should be attempted');},now});assert.equal(f.submission.ownerNotificationPending,true);
  f.emailRepository.updateOne=update;let sends=0;await deliverOriginalProjectEmails({...f,emailSender:async()=>{sends++;return{ok:true};},now});assert.equal(sends,1);
});
test('mix and master outputs save their email marker with the submission', async t => {
  const booking='444444444444444444444444',assetId='555555555555555555555555';let type='mix',saved;
  t.mock.method(Reservation,'findOne',async()=>({_id:booking,projectId,roundId:'round',musicianId,roleName:type,save:async()=>{}}));
  t.mock.method(Round,'findById',async()=>({type,state:'open'}));
  t.mock.method(originalSubmissionCommit,'run',async({payload})=>Submission.create(payload));
  t.mock.method(Asset,'findOne',async()=>({_id:assetId}));
  t.mock.method(Submission,'create',async record=>{saved=record;return{_id:'new-output',...record};});
  t.mock.method(Event,'create',async()=>({}));
  for(type of ['mix','master']) {
    const res=response();await submitOriginalProduction({user:{id:musicianId},params:{reservationId:booking},body:{outputAssetId:assetId}},res);
    assert.equal(res.code,201);assert.equal(saved.ownerNotificationPending,true);assert.equal(saved.category,type);
    const f=fixture();f.submission.category=type;f.submission.roleName=type;
    const sent=[];await deliverOriginalProjectEmails({...f,emailSender:async mail=>{sent.push(mail);return{ok:true};},now});assert.match(sent[0].text,new RegExp(`${type} output`));
  }
});
