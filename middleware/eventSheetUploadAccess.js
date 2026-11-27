import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Booking from '../models/bookingModel.js';
import User from '../models/userModel.js';

export function createEventSheetUploadAccess({
  secret = () => process.env.JWT_SECRET,
  staffEmails = () => ['hello@thesupremecollective.co.uk', process.env.AGENT_EMAIL].filter(Boolean),
  findBooking = query => Booking.findOne(query).select('_id bookingId userId').lean(),
  findClient = id => User.findById(id).select('_id').lean(),
} = {}) {
  return async (req, res, next) => {
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || req.headers.token;
    if (!token) return res.status(401).json({success:false,message:'Please sign in to upload a file.'});
    const key = secret();
    if (!key) return res.status(503).json({success:false,message:'Sign-in is temporarily unavailable.'});
    let user;
    try { user=jwt.verify(token,key,{algorithms:['HS256']}); }
    catch { return res.status(401).json({success:false,message:'Your session has expired. Please sign in again.'}); }
    const staff = !user.purpose && user.role === 'agent' && staffEmails().map(s=>String(s).trim().toLowerCase()).includes(String(user.email||'').trim().toLowerCase());
    const clientId = String(user.id || user.userId || user._id || '');
    if (!staff && (user.purpose || (user.role && user.role!=='client') || !mongoose.isValidObjectId(clientId))) {
      return res.status(403).json({success:false,message:'This account cannot upload files to this event sheet.'});
    }
    try {
      const ref=String(req.params.bookingId||'').trim();
      if (!ref) return res.status(400).json({success:false,message:'Booking reference is required.'});
      const query=mongoose.isValidObjectId(ref)?{$or:[{_id:ref},{bookingId:ref}]}:{bookingId:ref};
      const booking=await findBooking(query);
      // Do not reveal whether another client's booking exists.
      if (!booking || (!staff && (String(booking.userId||'')!==clientId || !await findClient(clientId)))) {
        return res.status(403).json({success:false,message:'This account is not linked to this booking. Please contact the TSC team, or sign in as TSC staff.'});
      }
      req.uploadBooking=booking;req.user=user;
      next();
    } catch {
      return res.status(503).json({success:false,message:'We could not check booking access. Please try again shortly.'});
    }
  };
}

export default createEventSheetUploadAccess();
