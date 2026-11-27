import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import Grant from '../models/eventSheetUploadGrant.js';
import Booking from '../models/bookingModel.js';
import {externalClientLink} from '../utils/bookingClientLinks.js';
export const hashUploadGrant=token=>createHash('sha256').update(String(token)).digest('hex');
export function uploadGrantMatches(grant,token,bookingId,now=new Date()) {
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||'') || !grant || grant.revokedAt || String(grant.bookingId)!==String(bookingId) || !Number.isFinite(new Date(grant.expiresAt).getTime()) || new Date(grant.expiresAt)<=now)return false;
 const saved=Buffer.from(grant.tokenHash||'','hex'),incoming=Buffer.from(hashUploadGrant(token),'hex');
 return saved.length===incoming.length && timingSafeEqual(saved,incoming);
}
export function uploadGrantExpiry(booking,now=new Date()) {
 const event=String(booking.eventDateISO||booking.date?.toISOString?.()||'').slice(0,10);
 const end=new Date(event+'T23:59:59Z');
 if(!Number.isNaN(end.getTime())){end.setUTCDate(end.getUTCDate()+7);return end;}
 return new Date(now.getTime()+90*86400000);
}
export async function ensureClientUploadLink(booking,{grantModel=Grant,now=new Date()}={}) {
 const expiry=uploadGrantExpiry(booking,now);
 if(expiry<=now)throw Error('This booking is outside its upload window.');
 let grant=await grantModel.findOne({bookingId:booking._id}).select('+token +tokenHash').lean();
 if(grant?.revokedAt)throw Error('This booking upload link has been revoked.');
 if(!grant){
  const token=randomBytes(32).toString('base64url');
  try {
   grant=await grantModel.findOneAndUpdate({bookingId:booking._id},{$setOnInsert:{bookingId:booking._id,token,tokenHash:hashUploadGrant(token),expiresAt:expiry,revokedAt:null}},{new:true,upsert:true}).select('+token +tokenHash').lean();
  }catch(error){if(error.code!==11000)throw error;grant=await grantModel.findOne({bookingId:booking._id}).select('+token +tokenHash').lean();}
 }
 if(new Date(grant.expiresAt)<=now)throw Error('This booking upload link has expired.');
 const url=new URL(`/event-sheet/${encodeURIComponent(booking.bookingId||String(booking._id))}`,'https://thesupremecollective.co.uk');
 url.hash=new URLSearchParams({upload:grant.token}).toString();return url.href;
}
export const verifyClientUploadGrant=async(booking,token)=>uploadGrantMatches(await Grant.findOne({bookingId:booking._id}).select('+tokenHash').lean(),token,booking._id);
// Only decorate private email-building copies, never the public booking payload.
export async function withClientUploadLink(row) {
 if(externalClientLink(row,'eventSheet'))return row;
 const ref=row.bookingRef||row.bookingId;
 if(typeof ref!=='string')return row;
 const booking=await Booking.findOne({bookingId:ref}).select('_id bookingId eventDateISO date').lean();
 return booking?{...row,_secureClientEventSheetUrl:await ensureClientUploadLink(booking)}:row;
}
