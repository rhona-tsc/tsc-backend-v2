import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { getOriginalAgreement, getOriginalOwnerAgreement, recordOriginalAgreement, originalOwnerAgreementAcceptance } from '../services/originalsAgreementService.js';
import { buildOriginalAgreementPdf, buildOriginalAgreementReceiptEmail, deliverOriginalAgreementReceipts } from '../services/originalsAgreementReceiptService.js';
import Acceptance from '../models/originalAgreementAcceptanceModel.js';
import Project from '../models/originalProjectModel.js';
import Notification from '../models/originalNotificationModel.js';
import { presentOriginalWorkspace } from '../services/originalsAccessService.js';

const projectId='111111111111111111111111', musicianId='222222222222222222222222', ownerId='333333333333333333333333';
const now=new Date('2026-11-06T10:25:30Z');
const signed = (type='contributor') => {
 const agreement=type==='owner'?getOriginalOwnerAgreement():getOriginalAgreement(type);
 return { _id:'accepted',projectId,projectTitle:'The project at signing',musicianId,roleName:type==='owner'?'Project owner':'Piano',type,reference:'accepted',fullName:'Example Musician',accepted:true,acceptedAt:now,version:agreement.version,text:agreement.text,textHash:agreement.textHash,receiptPending:true };
};
const setup=t=>originalsTransactionStore(t,{
 projects:[{_id:projectId,ownerId,title:'The project at signing',state:'role_round_open'}],
 musicians:[{_id:musicianId,email:'musician@example.test',firstName:'Example'},{_id:ownerId,email:'owner@example.test',firstName:'Owner'}],
 acceptances:[signed()],
});

test('acceptance records queue a copy only after validating the current agreement',async t=>{
 const s=setup(t);s.data.acceptances=[];
 for(const type of ['contributor','mix','master']) {
  const agreement=getOriginalAgreement(type);
  await recordOriginalAgreement({input:{...agreement,accepted:true,fullName:' Example   Musician '},projectId,projectTitle:'The signed title',musicianId,roleName:'Piano',type,now});
  const stored=s.data.acceptances.at(-1);
  assert.equal(stored.receiptPending,true);assert.equal(stored.text,agreement.text);assert.equal(stored.fullName,'Example Musician');assert.equal(stored.projectTitle,'The signed title');
 }
 const before=s.data.acceptances.length;
 await assert.rejects(recordOriginalAgreement({input:{...getOriginalAgreement(),accepted:false,fullName:'Example Musician'},projectId,musicianId,roleName:'Piano'}));
 assert.equal(s.data.acceptances.length,before);
 assert.equal(new Acceptance().receiptPending,false);
});

test('the generated PDF covers each agreement type, with bounded page counts and no regenerated wording',async()=>{
 for(const type of ['contributor','mix','master','owner']) {
  const record=signed(type),before=structuredClone(record);
  const buffer=await buildOriginalAgreementPdf(record),pdf=await PDFDocument.load(buffer);
  assert.ok(buffer.subarray(0,5).toString()==='%PDF-');assert.ok(pdf.getPageCount()>=3&&pdf.getPageCount()<=7);
  assert.match(pdf.getTitle(),/agreement/);assert.equal(pdf.getAuthor(),'The Supreme Collective Ltd');assert.deepEqual(record,before);
 }
 const old=signed();old.version='previous-signed-version';old.text='The exact earlier terms.\n\nI accept these earlier terms.';old.textHash=createHash('sha256').update(old.text).digest('hex');
 assert.ok((await buildOriginalAgreementPdf(old)).length>1000);
 await assert.rejects(buildOriginalAgreementPdf({...old,text:'Changed wording'}),/does not match/);
 await assert.rejects(buildOriginalAgreementPdf({...old,accepted:false}),/incomplete/);
});

test('one private PDF attachment goes to the signer and repeated workers do not resend it',async t=>{
 const s=setup(t),sent=[],records=[];
 const pdfBuilder=async record=>{records.push(record);return Buffer.from('%PDF-fixture');};
 const emailSender=async mail=>{sent.push(mail);return{ok:true};};
 await Promise.all([deliverOriginalAgreementReceipts({now,pdfBuilder,emailSender}),deliverOriginalAgreementReceipts({now,pdfBuilder,emailSender})]);
 await deliverOriginalAgreementReceipts({now,pdfBuilder,emailSender});
 assert.equal(sent.length,1);assert.equal(s.data.notifications.length,1);assert.equal(s.data.notifications[0].state,'sent');
 assert.equal(sent[0].to,'musician@example.test');assert.equal(sent[0].bcc,undefined);assert.equal(sent[0].cc,undefined);
 assert.equal(sent[0].attachments.length,1);assert.equal(sent[0].attachments[0].contentType,'application/pdf');assert.match(sent[0].attachments[0].filename,/contributor-agreement-2026-11-06.pdf$/);
 assert.equal(records[0].text,signed().text);assert.equal(s.data.acceptances[0].receiptPending,false);
});

test('signing through the agreement service produces a real PDF attachment for that account',async t=>{
 const s=setup(t);s.data.acceptances=[];
 const agreement=getOriginalAgreement('master');
 await recordOriginalAgreement({input:{...agreement,accepted:true,fullName:'Example Musician'},projectId,projectTitle:'Signed master project',musicianId,roleName:'Mastering engineer',type:'master',now});
 let mail;await deliverOriginalAgreementReceipts({now,emailSender:async value=>{mail=value;return{ok:true};}});
 const pdf=await PDFDocument.load(mail.attachments[0].content);
 assert.match(pdf.getTitle(),/Mastering engineer agreement - Signed master project/);
 assert.equal(mail.to,'musician@example.test');assert.equal(s.data.notifications[0].state,'sent');
});

test('queue failure retains the signature marker, and a failed email retries the same accepted snapshot',async t=>{
 t.mock.method(console,'error',()=>{});
 const s=setup(t),update=Notification.updateOne;
 t.mock.method(Notification,'updateOne',async()=>{throw new Error('Queue unavailable');});
 await deliverOriginalAgreementReceipts({now,emailSender:()=>assert.fail('nothing queued')});
 assert.equal(s.data.acceptances[0].receiptPending,true);
 t.mock.method(Notification,'updateOne',update);
 const records=[];const pdfBuilder=async record=>{records.push(record);return Buffer.from('%PDF-fixture');};
 await deliverOriginalAgreementReceipts({now,pdfBuilder,emailSender:async()=>({ok:false,error:'SMTP unavailable'})});
 const job=s.data.notifications[0];assert.equal(job.state,'queued');assert.equal(s.data.acceptances[0].accepted,true);
 s.data.projects[0].title='A later title';s.data.projects[0].state='archived';s.data.musicians[0].email='current@example.test';
 const sent=[];await deliverOriginalAgreementReceipts({now:new Date(+now+300000),pdfBuilder,emailSender:async mail=>{sent.push(mail);return{ok:true};}});
 assert.equal(sent[0].to,'current@example.test');assert.match(sent[0].subject,/The project at signing/);
 assert.deepEqual(records[0],records[1]);assert.equal(s.data.notifications[0].state,'sent');
});

test('PDF generation failures retry without changing the stored acceptance',async t=>{
 const s=setup(t),before=structuredClone(s.data.acceptances[0]);
 await deliverOriginalAgreementReceipts({now,pdfBuilder:async()=>{throw new Error('PDF temporarily unavailable');},emailSender:()=>assert.fail('No attachment')});
 assert.equal(s.data.notifications[0].state,'queued');
 assert.deepEqual({...s.data.acceptances[0],receiptPending:true},before);
 let sends=0;await deliverOriginalAgreementReceipts({now:new Date(+now+300000),pdfBuilder:async()=>Buffer.from('%PDF-fixture'),emailSender:async()=>{sends++;return{ok:true};}});assert.equal(sends,1);
});

test('owner copies recover both current and earlier signatures with their original names and wording',async t=>{
 const s=setup(t);s.data.acceptances=[];
 const agreement=getOriginalOwnerAgreement();
 const make=(displayName,date)=>originalOwnerAgreementAcceptance({ownerAgreementAccepted:true,ownerAgreementDisplayName:displayName,ownerAgreement:agreement},date);
 const earlier=make('Earlier Owner',new Date(+now-10000)),current=make('Current Owner',now);
 earlier.projectTitle='Earlier project title';current.projectTitle='The project at signing';
 s.data.projects[0].ownerAgreement=current;s.data.projects[0].ownerAgreementHistory=[earlier];
 const sent=[],records=[];
 await deliverOriginalAgreementReceipts({now,pdfBuilder:async record=>{records.push(record);return Buffer.from('%PDF-fixture');},emailSender:async mail=>{sent.push(mail);return{ok:true};}});
 assert.equal(sent.length,2);assert.ok(sent.every(mail=>mail.to==='owner@example.test'));
 assert.deepEqual(records.map(record=>record.fullName),['Current Owner','Earlier Owner']);
 assert.equal(records[1].projectTitle,'Earlier project title');assert.equal(records[1].text,earlier.text);
 assert.equal(s.data.projects[0].ownerAgreement.receiptPending,false);assert.equal(s.data.projects[0].ownerAgreementHistory[0].receiptPending,false);
 await deliverOriginalAgreementReceipts({now,emailSender:()=>assert.fail('no duplicates')});
});

test('a history-only pending owner signature is recovered after replacement',async t=>{
 const s=setup(t);s.data.acceptances=[];
 const earlier={...signed('owner'),displayName:'Owner',receiptPending:true};
 s.data.projects[0].ownerAgreement={accepted:true,receiptPending:false};s.data.projects[0].ownerAgreementHistory=[earlier];
 // Model the Mongo dotted-array query; the transaction helper handles numbered paths.
 t.mock.method(Project,'find',()=>({limit(){return this;},lean:async()=>s.data.projects}));
 let sent=0;await deliverOriginalAgreementReceipts({now,pdfBuilder:async()=>Buffer.from('%PDF-fixture'),emailSender:async()=>{sent++;return{ok:true};}});
 assert.equal(sent,1);assert.equal(s.data.projects[0].ownerAgreementHistory[0].receiptPending,false);
});

test('historical agreements stay quiet and removed recipients do not receive a copy',async t=>{
 const s=setup(t);delete s.data.acceptances[0].receiptPending;
 await deliverOriginalAgreementReceipts({now,emailSender:()=>assert.fail('no historical backfill')});assert.equal(s.data.notifications.length,0);
 s.data.acceptances[0].receiptPending=true;s.data.musicians=[];
 await deliverOriginalAgreementReceipts({now,emailSender:()=>assert.fail('deleted signer')});assert.equal(s.data.notifications[0].state,'cancelled');
});

test('abandoned delivery leases recover, and repeated failures stop after five attempts',async t=>{
 const s=setup(t),pdfBuilder=async()=>Buffer.from('%PDF-fixture');let attempts=0;
 const emailSender=async()=>{attempts++;return{ok:false,error:'SMTP unavailable'};};
 await deliverOriginalAgreementReceipts({now,pdfBuilder,emailSender});
 const job=s.data.notifications[0];job.state='sending';job.leaseExpiresAt=new Date(+now+300000);
 await deliverOriginalAgreementReceipts({now,pdfBuilder,emailSender});assert.equal(attempts,1);
 for(let retry=1;retry<=5;retry++) await deliverOriginalAgreementReceipts({now:new Date(+now+300000*retry),pdfBuilder,emailSender});
 assert.equal(attempts,5);assert.equal(job.state,'failed');
});

test('receipt email escapes private signing details and includes the footer and project button',()=>{
 const mail=buildOriginalAgreementReceiptEmail({...signed(),projectTitle:'<Song>',fullName:'<Person>'},'<Hi>');
 assert.match(mail.html,/&lt;Song&gt;/);assert.match(mail.html,/&lt;Person&gt;/);assert.match(mail.html,/&lt;Hi&gt;/);
 assert.doesNotMatch(mail.html,/<Song>|<Person>|<Hi>/);assert.match(mail.html,/>Open the project<\/a>/);assert.match(mail.html,/TSC_Signature_2026/);assert.match(mail.text,/Company Number: 16883956/);
});

test('signed agreement snapshots never appear in project notifications, including the owner workspace',()=>{
 const input={project:{_id:projectId,ownerId,requestedRoles:[]},rounds:[],reservations:[],submissions:[],assets:[],notifications:[{template:'originals_signed_agreement_copy',payload:{record:signed()}},{template:'ordinary_status'}],invitations:[],creditVersions:[],issues:[],messages:[]};
 const owner=presentOriginalWorkspace(input,{id:ownerId});
 assert.deepEqual(owner.notifications,[{template:'ordinary_status'}]);assert.doesNotMatch(JSON.stringify(owner),/Example Musician/);
 assert.equal(input.notifications.length,2);
});
