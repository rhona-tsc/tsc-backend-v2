import test from 'node:test';
import assert from 'node:assert/strict';
import {google} from 'googleapis';
import {buildAnonymousYoutubeMetadata, youtubeVisibility, isVocalist, publicMusicianRole, publishVideoToYoutube, updateYoutubeVideoMetadata} from '../services/youtubeVideoService.js';
const musician={_id:'123',firstName:'Sarah',lastName:'Smith',musicianSlug:'sarah-s',instrumentation:[{instrument:'Bass Guitar'}],tscApprovedBio:'Sarah Smith is a soulful bassist. Contact sarah@example.com or +44 7777 123456. Follow @sarahsmith.'};
test('metadata includes approved anonymised bio, TSC contacts, canonical profile and unique band links',()=>{
 const m=buildAnonymousYoutubeMetadata({musician,submission:{category:'function',suppliedTitle:'Live soul set'},bands:[{name:'Soul Allegiance',href:'/act/soul-allegiance/'},{name:'Soul Allegiance',href:'/act/soul-allegiance/'}]});
 assert.equal(m.title,'Sarah S | Bassist | Live soul set');assert.match(m.description,/Sarah S is a soulful bassist/);assert.match(m.description,/https:\/\/thesupremecollective.co.uk\/musician\/sarah-s/);assert.match(m.description,/hello@thesupremecollective.co.uk/);assert.equal(m.description.match(/Soul Allegiance:/g).length,1);
 assert.doesNotMatch(m.description,/Smith|sarah@example|7777|@sarahsmith|unlisted/i);assert.ok(m.tags.includes('Bassist'));
});
test('unsafe and private titles use generic promo footage, titles and tags fit YouTube limits',()=>{
 for(const title of ['Sarah Smith showreel','Contact +447777123456','WhatsApp Video.mp4','https://example.com'])assert.match(buildAnonymousYoutubeMetadata({musician,submission:{suppliedTitle:title}}).title,/Promo Footage$/);
 const m=buildAnonymousYoutubeMetadata({musician:{...musician,tscApprovedBio:'Biography '.repeat(1000)},submission:{},bands:Array.from({length:100},(_,i)=>({name:`An extremely long band name ${i}`,href:`/act/band-${i}/`}))});
 assert.ok(m.description.length<=5000);assert.ok(m.tags.join(',').length<=470);assert.ok(m.title.length<=100);
 assert.equal(youtubeVisibility(musician),'unlisted');assert.equal(youtubeVisibility({...musician,privateTestProfile:true}),'private');
});
test('new uploads default to unlisted visibility, return actual visibility and use supplied metadata',async t=>{
 process.env.YOUTUBE_CLIENT_ID='test';process.env.YOUTUBE_CLIENT_SECRET='test';process.env.YOUTUBE_REFRESH_TOKEN='test';
 t.mock.method(globalThis,'fetch',async()=>new Response('video',{headers:{'content-type':'video/mp4'}}));
 t.mock.method(google,'youtube',()=>({videos:{insert:async request=>{assert.equal(request.requestBody.status.privacyStatus,'unlisted');assert.deepEqual(request.requestBody.snippet.tags,['Bassist']);return{data:{id:'video123',status:{privacyStatus:'unlisted'}}};}}}));
 const result=await publishVideoToYoutube({mediaUrl:'https://example.com/video',metadata:{title:'Test',description:'Description',tags:['Bassist']}});assert.equal(result.privacyStatus,'unlisted');assert.equal(result.id,'video123');
});
test('existing video updates verify requested visibility instead of claiming publication incorrectly',async t=>{
 process.env.YOUTUBE_CLIENT_ID='test';process.env.YOUTUBE_CLIENT_SECRET='test';process.env.YOUTUBE_REFRESH_TOKEN='test';
 t.mock.method(google,'youtube',()=>({videos:{update:async()=>({data:{status:{privacyStatus:'private'}}})}}));
 await assert.rejects(updateYoutubeVideoMetadata({videoId:'existing',metadata:{},privacyStatus:'public'}),/not applied/);
});

test('non-singers are never labelled vocalists or included in the vocalist-only filter',()=>{
 const bassist={...musician,vocals:{type:["I don't sing"]}};
 assert.equal(isVocalist(bassist),false);assert.equal(publicMusicianRole(bassist),'Bassist');
 assert.equal(isVocalist({...musician,vocals:{type:['Lead Vocalist-Instrumentalist']}}),true);
});
