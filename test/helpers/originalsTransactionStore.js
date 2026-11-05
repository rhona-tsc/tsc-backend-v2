import Message from '../../models/originalMessageModel.js';
import Credit from '../../models/originalCreditVersionModel.js';
import Issue from '../../models/originalIssueModel.js';
import mongoose from 'mongoose';
import Project from '../../models/originalProjectModel.js';
import Round from '../../models/originalRoundModel.js';
import Reservation from '../../models/originalReservationModel.js';
import Submission from '../../models/originalSubmissionModel.js';
import Invitation from '../../models/originalInvitationModel.js';
import Asset from '../../models/originalAssetModel.js';
import Event from '../../models/originalEventModel.js';
import Notification from '../../models/originalNotificationModel.js';
import Musician from '../../models/musicianModel.js';
import Future from '../../models/originalRoleReservationModel.js';
const copy = value => value === undefined ? undefined : structuredClone(value);
const equal = (a,b) => a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : String(a) === String(b);
function matches(row, filter) {
  return Object.entries(filter).every(([key,value]) => {
    if(key==='$or') return value.some(part=>matches(row,part));
    const actual=key.split('.').reduce((obj,part)=>obj?.[part],row);
    if(value && typeof value==='object' && !(value instanceof Date)) return Object.entries(value).every(([op,expected]) => op==='$in'?expected.some(v=>equal(actual,v)):op==='$nin'?!expected.some(v=>equal(actual,v)):op==='$ne'?!equal(actual,expected):op==='$gt'?actual>expected:op==='$lte'?actual<=expected:op==='$exists'?(actual!==undefined)===expected:matches(actual||{},{[op]:expected}));
    return equal(actual,value);
  });
}
function assign(row, values) { for(const[key,value]of Object.entries(values||{})) {const parts=key.split('.');let target=row;for(const part of parts.slice(0,-1))target=target[part]||=( {} );target[parts.at(-1)]=copy(value);} }
export function originalsTransactionStore(t, initial) {
  let store={projects:[],rounds:[],reservations:[],submissions:[],invitations:[],assets:[],events:[],notifications:[],musicians:[],futures:[],messages:[],credits:[],issues:[],...copy(initial)},counter=100,serial=Promise.resolve();
  const session={endSession:async()=>{},withTransaction:async work=>{const before=serial;let release;serial=new Promise(r=>release=r);await before;const snapshot=copy(store);try{return await work();}catch(error){store=snapshot;throw error;}finally{release();}}};
  t.mock.method(mongoose,'startSession',async()=>session);
  for(const[Model,name]of[[Project,'projects'],[Round,'rounds'],[Reservation,'reservations'],[Submission,'submissions'],[Invitation,'invitations'],[Asset,'assets'],[Event,'events'],[Notification,'notifications'],[Musician,'musicians'],[Future,'futures'],[Message,'messages'],[Credit,'credits'],[Issue,'issues']]) {
    const doc=row=>row?{...copy(row),save:async function(options){if(options?.session) {if(options.session!==session)throw new Error('wrong session');}if(this.$where&&!matches(store[name].find(item=>equal(item._id,this._id))||{},this.$where))throw Object.assign(new Error('Document changed'),{name:'DocumentNotFoundError'});const record=Object.fromEntries(Object.entries(this).filter(([key,v])=>typeof v!=='function'&&key!=='$where'));store[name][store[name].findIndex(item=>equal(item._id,record._id))]=copy(record);return this;}}:null;
    const query=read=>({session(){return this;},select(){return this;},populate(){return this;},sort(){return this;},limit(){return this;},lean:async()=>copy(read()),then(resolve,reject){return Promise.resolve(read()).then(value=>Array.isArray(value)?value.map(doc):doc(value)).then(resolve,reject);}});
    t.mock.method(Model,'findById',id=>query(()=>store[name].find(row=>equal(row._id,id))||null));
    t.mock.method(Model,'findOne',filter=>query(()=>store[name].find(row=>matches(row,filter))||null));
    t.mock.method(Model,'find',filter=>query(()=>store[name].filter(row=>matches(row,filter||{}))));
    t.mock.method(Model,'countDocuments',async filter=>store[name].filter(row=>matches(row,filter)).length);
    t.mock.method(Model,'exists',filter=>({session(){return this;},then(resolve,reject){return Promise.resolve(store[name].some(row=>matches(row,filter))).then(resolve,reject);}}));
    t.mock.method(Model,'create',async(records,options)=>{const many=Array.isArray(records);const saved=(many?records:[records]).map(row=>{const next={_id:(++counter).toString(16).padStart(24,'0'),state:name==='submissions'?'submitted':name==='invitations'?'pending':'queued',revision:1,...copy(row)};store[name].push(next);return doc(next);});return many?saved:saved[0];});
    const update=async(filter,change,options,many)=>{let rows=store[name].filter(row=>matches(row,filter));if(!many)rows=rows.slice(0,1);if(!rows.length&&options?.upsert){const row={_id:(++counter).toString(16).padStart(24,'0'),state:'queued',attempts:0,...copy(filter),...copy(change.$setOnInsert)};store[name].push(row);rows=[row];}for(const row of rows){assign(row,change.$set);for(const[key,value]of Object.entries(change.$inc||{}))row[key]=(row[key]||0)+value;}return {modifiedCount:rows.length,matchedCount:rows.length};};
    t.mock.method(Model,'updateOne',(filter,change,options)=>update(filter,change,options,false));
    t.mock.method(Model,'updateMany',(filter,change,options)=>update(filter,change,options,true));
    t.mock.method(Model,'findOneAndUpdate',(filter,change)=>query(()=>{const row=store[name].find(row=>matches(row,filter));if(!row)return null;assign(row,change.$set);for(const[key,value]of Object.entries(change.$inc||{}))row[key]=(row[key]||0)+value;return row;}));
  }
  return {get data(){return store;},session};
}
