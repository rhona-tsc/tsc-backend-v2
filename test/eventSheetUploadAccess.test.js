import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {createEventSheetUploadAccess} from '../middleware/eventSheetUploadAccess.js';
import {hashUploadGrant,uploadGrantMatches} from '../services/eventSheetUploadGrantService.js';

const secret='synthetic-upload-unit-test-secret';
const owner='111111111111111111111111',other='222222222222222222222222';
const book={_id:'333333333333333333333333',bookingId:'synthetic-booking',userId:owner};
const response=()=>({code:200,status(code){this.code=code;return this;},json(value){this.body=value;return this;}});
const token=claims=>jwt.sign(claims,secret,{expiresIn:'1m'});
async function check(claims,{booking=book}={}) {
 let allowed=false,lookups=0;
 const middleware=createEventSheetUploadAccess({secret:()=>secret,staffEmails:()=>['staff@example.test'],findBooking:async()=>{lookups++;return booking;},findClient:async id=>({_id:id})});
 const req={headers:claims?{authorization:'Bearer '+token(claims)}:{},params:{bookingId:book.bookingId}};const res=response();
 await middleware(req,res,()=>{allowed=true;});return{allowed,res,lookups};
}
test('only linked clients or verified TSC staff can upload',async()=>{
 assert.equal((await check({id:owner})).allowed,true);
 assert.equal((await check({userId:owner,role:'client'})).allowed,true);
 assert.equal((await check({id:'agent',role:'agent',email:'staff@example.test'})).allowed,true);
 assert.equal((await check({id:other,role:'client'})).res.code,403);
 assert.equal((await check({id:owner,role:'musician'})).res.code,403);
 assert.equal((await check({id:owner,role:'admin'})).res.code,403);
 assert.equal((await check({id:owner,purpose:'musician_email_preferences'})).res.code,403);
});
test('a client link needs no account but cannot upload to another booking',async()=>{
 const value='A'.repeat(43),grant={bookingId:book._id,tokenHash:hashUploadGrant(value),expiresAt:new Date('2099-01-01')};
 const gate=createEventSheetUploadAccess({findBooking:async query=>query.bookingId===book.bookingId?book:{_id:'444444444444444444444444'},verifyGrant:async(b,t)=>uploadGrantMatches(grant,t,b._id)});
 for(const [ref,expected] of [[book.bookingId,true],['other-booking',false]]){
  let allowed=false;const res=response();await gate({headers:{authorization:'EventSheetUpload '+value},params:{bookingId:ref}},res,()=>{allowed=true;});assert.equal(allowed,expected);
 }
});
test('a reference or matching email alone cannot authorize an upload',async()=>{
 const anonymous=await check(null);assert.equal(anonymous.res.code,401);assert.equal(anonymous.lookups,0);
 assert.equal((await check({id:other,email:'client@example.test'},{booking:{...book,clientEmail:'client@example.test'}})).allowed,false);
 assert.equal((await check({id:owner},{booking:{...book,userId:undefined}})).allowed,false);
 assert.equal((await check({id:owner},{booking:null})).allowed,false);
});
