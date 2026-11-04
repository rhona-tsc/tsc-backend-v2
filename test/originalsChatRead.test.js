import test from 'node:test';
import assert from 'node:assert/strict';
import Read from '../models/originalChatReadModel.js';
import Message from '../models/originalMessageModel.js';
import Project from '../models/originalProjectModel.js';
import { originalChatUnreadCount, originalChatUnreadQuery, markOriginalChatRead } from '../services/originalsChatReadService.js';
import { getOriginalChatUnread, readOriginalChat } from '../controllers/originalsChatReadController.js';
const projectId='111111111111111111111111',viewer='222222222222222222222222',other='333333333333333333333333',differentProject='444444444444444444444444';
const id=n=>n.toString(16).padStart(24,'0');
const at=new Date('2026-11-04T20:00:00.000Z');
const message=(n,authorId=other,offset=0)=>({_id:id(n),projectId,authorId,createdAt:new Date(+at+offset),body:'message'});
function setup(t,rows){
 const states=new Map(),updates=[],key=q=>`${q.projectId}:${q.musicianId}`;
 t.mock.method(Read,'findOne',query=>({select:()=>({lean:async()=>states.has(key(query))?{readThroughKey:states.get(key(query))}:null})}));
 t.mock.method(Read,'updateOne',async(query,change,options)=>{updates.push({query,change,options});const previous=states.get(key(query));if(!previous||change.$max.readThroughKey>previous)states.set(key(query),change.$max.readThroughKey);});
 t.mock.method(Message,'findOne',query=>({select:()=>({lean:async()=>rows.find(row=>String(row._id)===String(query._id)&&String(row.projectId)===String(query.projectId))||null})}));
 t.mock.method(Message,'countDocuments',async query=>rows.filter(row=>row.projectId===query.projectId&&row.authorId!==query.authorId.$ne&&(!query.$or||+row.createdAt>+query.$or[0].createdAt.$gt||(+row.createdAt===+query.$or[1].createdAt&&row._id>query.$or[1]._id.$gt))).length);
 t.mock.method(Project,'exists',async()=>true);
 return{states,updates};
}
const response=()=>({code:200,status(code){this.code=code;return this;},set(){return this;},json(body){this.body=body;return this;}});
test('unread summaries exclude own messages and include text, voice and attachment-only messages without marking read',async t=>{
 const rows=[message(1),message(2,viewer),{...message(3),body:'',voiceAssetId:id(99)},{...message(4),body:'',attachmentIds:[id(98)]},{...message(5),projectId:differentProject}];const{updates}=setup(t,rows);
 assert.equal(await originalChatUnreadCount({projectId,musicianId:viewer}),3);assert.equal(updates.length,0);
 const res=response();await getOriginalChatUnread({params:{id:projectId},user:{id:viewer}},res);assert.deepEqual(res.body,{success:true,unreadCount:3});assert.equal(updates.length,0);
});
test('read acknowledgements stop at the rendered message, including equal-time messages ordered by ID',async t=>{
 setup(t,[message(1),message(2),message(3),message(4,other,1000)]);
 assert.equal(await markOriginalChatRead({projectId,musicianId:viewer,messageId:id(2)}),2);
 assert.equal(await markOriginalChatRead({projectId,musicianId:viewer,messageId:id(3)}),1);
});
test('older tabs cannot rewind a newer read position and each person keeps a separate position',async t=>{
 const{states}=setup(t,[message(1),message(2),message(3)]);
 await markOriginalChatRead({projectId,musicianId:viewer,messageId:id(3)});const cursor=states.get(`${projectId}:${viewer}`);
 await markOriginalChatRead({projectId,musicianId:viewer,messageId:id(1)});assert.equal(states.get(`${projectId}:${viewer}`),cursor);assert.equal(await originalChatUnreadCount({projectId,musicianId:viewer}),0);
 assert.equal(await originalChatUnreadCount({projectId,musicianId:id(55)}),3);
});
test('a message arriving while a read is saved remains unread',async t=>{
 const rows=[message(1),message(2)];setup(t,rows);
 t.mock.method(Read,'updateOne',async(query,update)=>{rows.push(message(3,other,1000));t.mock.method(Read,'findOne',()=>({select:()=>({lean:async()=>({readThroughKey:update.$max.readThroughKey})})}));});
 assert.equal(await markOriginalChatRead({projectId,musicianId:viewer,messageId:id(2)}),1);
});
test('the server obtains the cursor from this project and ignores supplied identity/timestamps',async t=>{
 const{updates}=setup(t,[message(1),{...message(2),projectId:differentProject}]);
 await assert.rejects(markOriginalChatRead({projectId,musicianId:viewer,messageId:'invalid'}),{status:400});await assert.rejects(markOriginalChatRead({projectId,musicianId:viewer,messageId:id(2)}),{status:404});assert.equal(updates.length,0);
 const res=response();await readOriginalChat({params:{id:projectId},user:{id:viewer},body:{messageId:id(1),musicianId:other,readThroughKey:'9999-future',createdAt:'9999-01-01'}},res);
 assert.equal(res.code,200);assert.equal(updates[0].query.musicianId,viewer);assert.equal(updates[0].change.$max.readThroughKey,`${at.toISOString()}|${id(1)}`);
});
test('a simultaneous first read retries a unique-index race without losing the acknowledgement',async t=>{
 setup(t,[message(1)]);let calls=0;
 t.mock.method(Read,'updateOne',async(_query,_update,options)=>{calls++;if(calls===1){assert.equal(options.upsert,true);throw Object.assign(new Error('race'),{code:11000});}assert.equal(options.upsert,undefined);assert.deepEqual(options.collation,{locale:'simple'});});
 await markOriginalChatRead({projectId,musicianId:viewer,messageId:id(1)});assert.equal(calls,2);
});
test('bad or absent saved cursors never hide unread messages',()=>{
 for(const readThroughKey of [undefined,'invalid','9999-future','2026-99-99T20:00:00.000Z|'+id(1)])assert.equal(originalChatUnreadQuery({projectId,musicianId:viewer,readThroughKey}).$or,undefined);
});
