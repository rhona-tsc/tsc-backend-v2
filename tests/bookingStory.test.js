import test from 'node:test';
import assert from 'node:assert/strict';
import { storyDay, storyDue, storyEligible, storyReady, storyComplete, publicStoryDetails } from '../utils/bookingStoryPolicy.js';
import { publishStoryDestination } from '../services/bookingStoryPublisher.js';
const now = new Date('2026-11-17T12:00:00Z');
test('UK daily boundary and posting time respect summer time', () => {
 assert.equal(storyDay(new Date('2027-06-01T23:30Z')), '2027-06-02');
 assert.equal(storyDue({hour:12,minute:0},new Date('2027-06-01T10:59Z')),false);
 assert.equal(storyDue({hour:12,minute:0},new Date('2027-06-01T11:00Z')),true);
});
test('only secured future bookings are eligible, including on manual publish',()=>{
 const row={eventDateISO:'2027-01-16'};
 assert.equal(storyEligible(row,{status:'confirmed'},now),true);
 for(const status of ['pending','provisional','cancelled']) assert.equal(storyEligible(row,{status},now),false);
 assert.equal(storyEligible({...row,eventDateISO:'2026-01-16'},{status:'confirmed'},now),false);
});
test('public details exclude customer information and approval is required',()=>{
 assert.deepEqual(publicStoryDetails({actName:'Act',eventDateISO:'2027-01-16',bookerName:'Private',email:'private@example.org'}),{actName:'Act',eventDateISO:'2027-01-16',venueName:'',venueLocation:''});
 assert.equal(Boolean(storyReady({confirmed:true,approved:false,mediaUrl:'https://a',platforms:['instagram']})),false);
 assert.equal(storyComplete({platforms:['instagram','facebook'],instagram:{state:'published'},facebook:{state:'pending'}}),false);
});
test('Instagram processing resumes its existing container and never republishes recorded success',async()=>{
 const original=global.fetch;const calls=[];
 global.fetch=async(url,opts)=>{calls.push([url,opts.method]);return {ok:true,json:async()=>url.includes('media_publish')?{id:'posted'}:{status_code:'FINISHED'}}};
 try{
 const job={mediaUrl:'https://media',instagram:{state:'processing',containerId:'container'},save:async()=>{}};
 await publishStoryDestination(job,'instagram',{token:'test',instagramId:'account'});
 assert.equal(job.instagram.state,'published');assert.equal(calls.length,2);
 assert.ok(!calls.some(([u])=>u.endsWith('/media')));
 await publishStoryDestination(job,'instagram',{token:'test',instagramId:'account'});assert.equal(calls.length,2);
 }finally{global.fetch=original;}
});
test('ambiguous provider response is held, never retried automatically',async()=>{
 const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw new Error('Connection lost');};
 try{const job={instagram:{state:'pending'},save:async()=>{}};
 await publishStoryDestination(job,'instagram',{token:'test',instagramId:'account'});
 assert.equal(job.instagram.state,'needs_check');
 await publishStoryDestination(job,'instagram',{token:'test',instagramId:'account'});assert.equal(calls,1);
 }finally{global.fetch=original;}
});

test('Facebook finalizes an uploaded story before waiting for publication',async()=>{
 const original=global.fetch;const calls=[];
 global.fetch=async(url,opts)=>{calls.push([url,opts.method]);return {ok:true,json:async()=>opts.method==='GET'?{status:{video_status:'upload_complete',uploading_phase:{status:'complete'}}}:{success:true,post_id:'fb-story'}}};
 try{const job={facebook:{state:'processing',containerId:'uploaded-video'},save:async()=>{}};
 await publishStoryDestination(job,'facebook',{token:'test',pageId:'page'});
 assert.equal(job.facebook.state,'published');assert.equal(job.facebook.mediaId,'fb-story');
 assert.equal(calls.length,2);assert.ok(calls[1][0].endsWith('/page/video_stories'));
 }finally{global.fetch=original;}
});
