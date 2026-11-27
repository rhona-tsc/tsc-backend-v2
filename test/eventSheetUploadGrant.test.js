import test from 'node:test';import assert from 'node:assert/strict';
import {hashUploadGrant,uploadGrantMatches,uploadGrantExpiry,ensureClientUploadLink} from '../services/eventSheetUploadGrantService.js';
const token='A'.repeat(43),bookingId='111111111111111111111111';
const grant={bookingId,tokenHash:hashUploadGrant(token),expiresAt:new Date('2027-02-01')};
test('upload grants are scoped to one booking and expire or revoke without acting as login tokens',()=>{
 const now=new Date('2027-01-01');
 assert.equal(uploadGrantMatches(grant,token,bookingId,now),true);
 assert.equal(uploadGrantMatches(grant,token,'222222222222222222222222',now),false);
 assert.equal(uploadGrantMatches(grant,'B'.repeat(43),bookingId,now),false);
 assert.equal(uploadGrantMatches({...grant,revokedAt:now},token,bookingId,now),false);
 assert.equal(uploadGrantMatches({...grant,expiresAt:'bad'},token,bookingId,now),false);
 assert.equal(uploadGrantMatches(grant,token,bookingId,new Date('2027-03-01')),false);
 assert.equal(uploadGrantExpiry({eventDateISO:'2027-01-16'},now).toISOString().slice(0,10),'2027-01-23');
});
test('existing private grants produce reusable fragment links without exposing tokens in the booking record',async()=>{
 const stored={...grant,token};
 const grantModel={findOne:()=>({select:()=>({lean:async()=>stored})})};
 const link=await ensureClientUploadLink({_id:bookingId,bookingId:'synthetic-booking',eventDateISO:'2027-01-16'},{grantModel,now:new Date('2027-01-01')});
 const url=new URL(link);assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('upload'),token);
 assert.equal(url.pathname,'/event-sheet/synthetic-booking');
});
