import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import requireStaffAuth from '../middleware/requireStaffAuth.js';

// Synthetic credentials for isolated unit tests only; never use a production secret.
const key='notification-access-unit-test-key';
test('notifications reject clients, musicians, arbitrary admin claims and unsigned access',()=>{
 const previous=process.env.JWT_SECRET;process.env.JWT_SECRET=key;
 try {
  for(const user of [null,{role:'client',email:'client@example.test'},{role:'musician',email:'musician@example.test'},
   {role:'admin',id:'release-validation'},{role:'agent',email:'another-agent@example.test'}]) {
   let next=false;const req={headers:user?{authorization:'Bearer '+jwt.sign(user,key)}:{}};
   const res={status(code){this.code=code;return this;},json(){return this;}};
   requireStaffAuth(req,res,()=>{next=true;});
   assert.equal(next,false);assert.equal(res.code,user?403:401);
  }
  let allowed=false;requireStaffAuth({headers:{authorization:'Bearer '+jwt.sign({role:'agent',email:'hello@thesupremecollective.co.uk'},key)}},
   {status(){throw Error('Staff blocked');}},()=>{allowed=true;});assert.equal(allowed,true);
 } finally {if(previous==null)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});
