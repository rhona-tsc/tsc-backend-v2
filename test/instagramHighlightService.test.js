import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstagramHighlights } from '../services/instagramHighlightService.js';
test('saves photos and video cover images as stable image-only highlights',async()=>{
 const calls=[];
 const posts=await buildInstagramHighlights([
  {id:'photo',media_type:'IMAGE',media_url:'https://scontent.cdninstagram.com/photo.jpg?expires=soon'},
  {id:'reel',media_type:'VIDEO',media_url:'https://scontent.cdninstagram.com/video.mp4',thumbnail_url:'https://scontent.cdninstagram.com/cover.jpg'}
 ],{musicianId:'musician',upload:async(source,options)=>{calls.push({source,options});return {secure_url:`https://res.cloudinary.com/test/image/upload/${options.public_id}.jpg`};}});
 assert.equal(posts.length,2);assert.ok(posts.every(p=>p.mediaType==='image'&&p.mediaUrl.startsWith('https://res.cloudinary.com/')));
 assert.ok(calls[1].source.endsWith('cover.jpg'));assert.equal(posts[0].url,'');
});
test('does not save unsupported hosts or an empty upload result',async()=>{
 await assert.rejects(buildInstagramHighlights([{media_url:'https://example.com/image.jpg'}],{upload:()=>assert.fail('must not upload')}),/unsupported image host/);
 await assert.rejects(buildInstagramHighlights([{id:'a',media_url:'https://x.cdninstagram.com/image.jpg'}],{upload:async()=>({})}),/could not be saved/);
});
