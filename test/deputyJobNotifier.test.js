import assert from "node:assert/strict";
import test from "node:test";

process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_USER = 'test@example.test';
process.env.SMTP_PASS = 'test-only';
process.env.SMTP_RATE_LIMIT_DELAY_MS = '0';
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'deputy-preferences-test';
process.env.ADMIN_FRONTEND_URL =
  process.env.ADMIN_FRONTEND_URL || "https://admin.example.test";

test("deputy job email includes multi-date, multi-role and rate details", async () => {
  const { previewDeputyJobEmail } = await import(
    "../services/deputyJobNotifier.js"
  );

  const preview = await previewDeputyJobEmail({
    musician: {
      firstName: "Alex",
      matchedRoles: ["Saxophone", "Keys"],
    },
    job: {
      _id: "job-123",
      title: "Commercial shoot",
      instrument: "Trumpet",
      requiredInstruments: ["Trumpet", "Saxophone", "Keys"],
      roleRequirements: [
        { role: "Trumpet", quantity: 2 },
        { role: "Saxophone", quantity: 2 },
        { role: "Keys", quantity: 1 },
      ],
      eventDate: "2026-10-21",
      eventEndDate: "2026-10-22",
      fee: 180,
      feeBasis: "per_day",
      startTime: "08:00",
      endTime: "18:00",
      location: "Within the M25",
      setLengths: ["Full shoot day"],
      whatsIncluded: ["refreshments"],
      claimableExpenses: ["parking"],
      notes: "Bring your instrument.",
    },
  });

  assert.match(preview.text, /Wed, 21 Oct 2026 – Thu, 22 Oct 2026/);
  assert.match(preview.text, /Your matching roles: Saxophone, Keys/);
  assert.match(preview.text, /2 × Trumpet, 2 × Saxophone, 1 × Keys/);
  assert.match(preview.text, /Deputy fee: £180 per day/);
  assert.match(preview.text, /Included: refreshments/);
  assert.match(preview.text, /Claimable expenses: parking/);
  assert.match(preview.html, /All roles required/);
});


test('deputy sending skips opted-out musicians and gives others their own signed preferences link', async t => {
  const { default: nodemailer } = await import('nodemailer');
  const { default: Preferences } = await import('../models/musicianEmailPreferenceModel.js');
  const { musicianEmailHash, verifyMusicianEmailPreferencesToken } = await import('../utils/musicianEmailPreferences.js');
  const { notifyMusiciansAboutDeputyJob } = await import('../services/deputyJobNotifier.js');
  const sent=[]; let closed=false;
  t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{sent.push(mail);},close:async()=>{closed=true;}}));
  t.mock.method(Preferences,'findOne',({emailHash})=>({lean:async()=>emailHash===musicianEmailHash('stop@example.test')?{deputyOpportunities:false}:null}));
  const result=await notifyMusiciansAboutDeputyJob({job:{_id:'job-123',title:'Session',instrument:'Bass'},musicians:[{email:'stop@example.test'},{email:'go@example.test'}]});
  assert.deepEqual(result.map(row=>row.status),['skipped','sent']);assert.equal(sent.length,1);assert.equal(sent[0].to,'go@example.test');assert.equal(closed,true);
  assert.doesNotMatch(sent[0].text,/mailto:.*unsubscribe/i);
  const link=sent[0].text.match(/https:\/\/[^\s]+\/email-preferences\?token=[^\s]+/)[0];
  assert.equal(verifyMusicianEmailPreferencesToken(new URL(link).searchParams.get('token')),musicianEmailHash('go@example.test'));
});


test('deputy sending respects a confirmed booking withdrawal and still contacts available musicians', async t => {
 const {default:nodemailer}=await import('nodemailer');
 const {default:Preferences}=await import('../models/musicianEmailPreferenceModel.js');
 const {default:Availability}=await import('../models/availabilityModel.js');
 const {default:Message}=await import('../models/EnquiryMessage.js');
 const {notifyMusiciansAboutDeputyJob}=await import('../services/deputyJobNotifier.js');
 const {withdrawalAvailabilityRecord}=await import('../utils/bookingWithdrawal.js');
 const withdrawn='111111111111111111111111', available='222222222222222222222222';
 const date='2099-12-31';
 const row=withdrawalAvailabilityRecord({board:{_id:'333333333333333333333333',bookingRef:'EXAMPLE',eventDateISO:date},assignment:{musicianId:withdrawn,roleSlotId:'keyboard-1'},reason:'Away',source:'musician_portal',now:new Date()});
 const query=rows=>({select(){return this;},lean:async()=>rows});
 const sent=[];
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>sent.push(mail),close:async()=>{}}));
 t.mock.method(Preferences,'findOne',()=>({lean:async()=>null}));
 t.mock.method(Availability,'find',()=>query([row]));
 t.mock.method(Message,'find',()=>query([]));
 const result=await notifyMusiciansAboutDeputyJob({job:{_id:'job-test',title:'Keyboard',eventDate:date,instrument:'Keyboard'},musicians:[{_id:withdrawn,email:'away@example.test'},{_id:available,email:'available@example.test'}]});
 assert.deepEqual(result.map(n=>n.status),['skipped','sent']);
 assert.match(result[0].error,/Already unavailable/);
 assert.deepEqual(sent.map(m=>m.to),['available@example.test']);
});
