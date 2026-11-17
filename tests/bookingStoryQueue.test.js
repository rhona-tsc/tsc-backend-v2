import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingStory, StoryDay, StoryLease, StorySettings } from '../models/bookingStoryModel.js';
import Board from '../models/bookingBoardItem.js';
import Booking from '../models/bookingModel.js';
import Musician from '../models/musicianModel.js';
import { encryptSocialToken } from '../utils/socialTokenCrypto.js';
import { runBookingStoryQueue } from '../services/bookingStoryQueue.js';

test('competing runners and a second booking cannot publish twice in one UK day', async()=>{
 const restored=[]; const stub=(object,key,value)=>{const old=object[key];object[key]=value;restored.push(()=>object[key]=old);};
 const env=process.env.SOCIAL_OAUTH_ENCRYPTION_KEY;process.env.SOCIAL_OAUTH_ENCRYPTION_KEY='isolated-test-key';
 const slots=new Map();let leased=false;let publications=0;
 const jobs=['one','two'].map(id=>({_id:id,bookingId:id,eventDateISO:'2027-01-16',actId:'act',confirmed:true,approved:true,mediaUrl:'https://media',platforms:['instagram'],status:'queued',instagram:{state:'pending'},save:async()=>{}}));
 const settings={enabled:true,hour:12,minute:0,accountMusicianId:'admin',expectedInstagramId:'ig',expectedPageId:'page'};
 try {
 for(const model of [BookingStory,StoryDay,StoryLease]) stub(model,'init',async()=>{});
 stub(StoryLease,'updateOne',async(query)=>{if(query.owner)leased=false;return {};});
 stub(StoryLease,'findOneAndUpdate',async()=>{if(leased)return null;leased=true;return {};});
 stub(StorySettings,'findByIdAndUpdate',async()=>settings);
 stub(Musician,'findById',()=>({select:()=>({lean:async()=>({socialConnections:{meta:{accountId:'ig',pageId:'page',scopes:['instagram_content_publish','pages_manage_posts'],accessTokenEncrypted:encryptSocialToken('fake')}}})})}));
 stub(StoryDay,'findById',async(day)=>slots.get(day));
 stub(StoryDay,'create',async(slot)=>{if(slots.has(slot._id))throw Object.assign(new Error('duplicate'),{code:11000});slots.set(slot._id,slot);return slot;});
 stub(BookingStory,'findById',async(id)=>jobs.find(j=>j._id===id));
 stub(Board,'findById',id=>({lean:async()=>({bookingId:id,actId:'act',eventDateISO:'2027-01-16'})}));
 stub(Booking,'findById',()=>({select:()=>({lean:async()=>({status:'confirmed'})})}));
 stub(global,'fetch',async(url)=>({ok:true,json:async()=>url.includes('media_publish')?(publications++,{id:'published'}):url.includes('?fields')?{status_code:'FINISHED'}:{id:'container'}}));
 const results=await Promise.all([runBookingStoryQueue({manualStoryId:'one',now:new Date('2026-11-17T12:00Z')}),runBookingStoryQueue({manualStoryId:'two',now:new Date('2026-11-17T12:00Z')})]);
 assert.equal(publications,1);assert.ok(results.some(r=>r.state==='busy'));assert.equal(slots.size,1);
 const blocked=await runBookingStoryQueue({manualStoryId:'two',now:new Date('2026-11-17T13:00Z')});assert.equal(blocked.state,'daily_limit');assert.equal(publications,1);
 await runBookingStoryQueue({manualStoryId:'two',now:new Date('2026-11-18T12:00Z')});assert.equal(publications,2);
 } finally {restored.reverse().forEach(f=>f());if(env===undefined)delete process.env.SOCIAL_OAUTH_ENCRYPTION_KEY;else process.env.SOCIAL_OAUTH_ENCRYPTION_KEY=env;}
});
