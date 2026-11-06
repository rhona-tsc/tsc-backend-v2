import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import automationRoutes from '../routes/automationConfigRoutes.js';

test('the dashboard reads the sender allowlist, including environment additions, through an admin-only endpoint',async()=>{
  const keys=['JWT_SECRET','CLIENT_AUTOMATION_EMAIL_ALLOWLIST','CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  process.env.JWT_SECRET='automation-allowlist-test-only-secret';
  process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST='extra@example.test';
  process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST='ExtraRef';
  const app=express();app.use('/api/automation-config',automationRoutes);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/automation-config/allowlist`;
    assert.equal((await fetch(url)).status,401);
    const rejected=jwt.sign({email:'other@example.test'},process.env.JWT_SECRET);
    assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${rejected}`}})).status,403);
    const token=jwt.sign({email:'hello@thesupremecollective.co.uk'},process.env.JWT_SECRET);
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const policy=await response.json();assert.equal(policy.success,true);
    assert.ok(policy.emails.includes('sue_young1576@hotmail.com'));
    assert.ok(policy.bookingRefs.includes('UUZfW'));
    assert.ok(policy.emails.includes('extra@example.test'));
    assert.ok(policy.bookingRefs.includes('ExtraRef'));
  } finally {
    await new Promise(resolve=>server.close(resolve));
    for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
});
