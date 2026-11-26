import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, stat, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import express from 'express';
import { v2 as cloudinary } from 'cloudinary';
import Musician from '../models/musicianModel.js';
import Video from '../models/musicianVideoSubmissionModel.js';
import { createMusicianVideoUpload } from '../middleware/musicianVideoUpload.js';
import { uploadMusicianVideo, authoriseMusicianVideoUpload } from '../controllers/musicianVideoSubmissionController.js';

const owner = '111111111111111111111111';
const response = () => ({ code:200, status(code){this.code=code;return this;}, json(body){this.body=body;return this;} });
const sleep = () => new Promise(resolve => setTimeout(resolve, 10));
async function temporary(t) {
 const root=await mkdtemp(path.join(tmpdir(),'tsc-video-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
async function server(t, options, handler) {
 const app=express();app.post('/video',createMusicianVideoUpload(options),handler);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 return server.address().port;
}
async function post(port, {bytes=9*1024*1024, mime='video/mp4', abort=false}={}) {
 const head=Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="video"; filename="showreel.mp4"\r\nContent-Type: ${mime}\r\n\r\n`);
 const tail=Buffer.from('\r\n--test-boundary--\r\n');
 const req=http.request({host:'127.0.0.1',port,path:'/video',method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=test-boundary','Content-Length':head.length+bytes+tail.length}});
 const done=new Promise(resolve=>{req.on('response',res=>{let body='';res.on('data',part=>{body+=part;});res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',()=>resolve({aborted:true}));});
 const chunk=Buffer.alloc(64*1024,7);req.write(head);
 for(let sent=0;sent<bytes;sent+=chunk.length){
  if(abort&&sent>=1024*1024){req.destroy();return done;}
  if(!req.write(chunk.subarray(0,Math.min(chunk.length,bytes-sent)))){await Promise.race([once(req,'drain'),done]);if(req.destroyed)break;}
 }
 if(!req.destroyed)req.end(tail);return done;
}
async function assertEmpty(root) {
 for(let i=0;i<100;i++){if(!(await readdir(root)).length)return;await sleep();}
 assert.deepEqual(await readdir(root),[]);
}

test('large multipart videos are received on disk without an in-memory file buffer and removed after success',async t=>{
 const root=await temporary(t);let seen=false;
 const port=await server(t,{temporaryRoot:root},async(req,res)=>{
  assert.equal(req.file.buffer,undefined);assert.equal(req.file.size,100*1024*1024);
  assert.equal((await stat(req.file.path)).size,req.file.size);seen=true;res.json({success:true});
 });
 assert.equal((await post(port,{bytes:100*1024*1024})).status,200);assert.equal(seen,true);await assertEmpty(root);
});
test('oversized and unsupported videos fail before the controller and leave no temporary files',async t=>{
 const root=await temporary(t);
 const port=await server(t,{temporaryRoot:root,maxBytes:1024*1024},()=>assert.fail('invalid upload reached controller'));
 assert.equal((await post(port,{bytes:1024*1024+1})).status,413);await assertEmpty(root);
 assert.equal((await post(port,{mime:'text/plain',bytes:128})).status,415);await assertEmpty(root);
});
test('a client disconnect removes its partial video',async t=>{
 const root=await temporary(t);const port=await server(t,{temporaryRoot:root},()=>assert.fail('partial upload reached controller'));
 assert.equal((await post(port,{abort:true})).aborted,true);await assertEmpty(root);
});
test('unauthorised profile uploads are rejected before receiving file bytes',()=>{
 const req={params:{id:owner},user:{id:'222222222222222222222222'}};const res=response();
 authoriseMusicianVideoUpload(req,res,()=>assert.fail('must not receive this upload'));assert.equal(res.code,403);
});
for(const fail of [false,true])test(`video transfer uses bounded stream chunks and cleans up after ${fail?'storage failure':'saving the private video'}`,async t=>{
 const root=await temporary(t);const filePath=path.join(root,'video');await writeFile(filePath,Buffer.alloc(3*1024*1024));
 t.mock.method(console,'error',()=>{});
 t.mock.method(Musician,'findById',()=>({select:async()=>({_id:owner,firstName:'Test'})}));
 t.mock.method(Video,'exists',async()=>false);
 let saved; t.mock.method(Video,'create',async values=>(saved={...values,_id:'222222222222222222222222',save:async()=>{}}));
 t.mock.method(globalThis,'fetch',async()=>{throw Error('offline test');});
 cloudinary.config({cloud_name:'test',api_key:'test',api_secret:'test'});
 let received=0,maxChunk=0;
 t.mock.method(cloudinary.uploader,'upload_stream',(options,callback)=>{
  assert.equal(options.type,'authenticated');assert.equal(options.resource_type,'video');
  return new Writable({write(chunk,encoding,done){received+=chunk.length;maxChunk=Math.max(maxChunk,chunk.length);done(fail?new Error('storage unavailable'):undefined);},final(done){callback(null,{public_id:'saved/private',format:'mp4',resource_type:'video'});done();}});
 });
 const req={params:{id:owner},user:{id:owner},body:{},file:{path:filePath,mimetype:'video/mp4',size:3*1024*1024,originalname:'showreel.mp4'},cleanupVideoUpload:()=>rm(root,{recursive:true,force:true})};
 const res=response();await uploadMusicianVideo(req,res);
 assert.equal(res.code,fail?500:201);assert.ok(maxChunk<=64*1024);
 if(!fail){assert.equal(received,req.file.size);assert.equal(saved.cloudinaryPublicId,'saved/private');}
 await assert.rejects(access(filePath));
});
