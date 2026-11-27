// controllers/notificationsController.js
import Booking from "../models/bookingModel.js";
import axios from "axios";
import sendEmail from "../utils/sendEmail.js";
import cloudinary from "../config/cloudinary.js";

import Board from "../models/bookingBoardItem.js";
import Musician from "../models/musicianModel.js";
import {createCateringHandlers} from "../services/eventSheetCateringNotification.js";

export const loadConfirmedCateringRoster = async booking => {
  const board = await Board.findOne({$or:[{bookingId:booking._id},{sourceBookingId:booking._id},{bookingRef:booking.bookingId}]}).lean();
  const members = [board?.assignedMusicians,board?.bookingMusicians,board?.bandLineup,booking.assignedMusicians,booking.bandLineup]
    .find(items => Array.isArray(items) && items.length) || [];
  const confirmed = members.filter(member => !member.withdrawnAt && ['accepted','confirmed'].includes(String(member.status).toLowerCase()));
  const profiles = await Musician.find({_id:{$in:confirmed.map(m=>m.musicianId).filter(Boolean)}}).select('firstName lastName email dietaryRequirements').lean();
  const byId = new Map(profiles.map(p=>[String(p._id),p]));
  return confirmed.map(member => {
    const profile=byId.get(String(member.musicianId));
    return {name:member.name || [profile?.firstName,profile?.lastName].filter(Boolean).join(' '),
      instrument:member.instrument||member.role||'Musician',email:profile?.email||member.email||'',
      dietaryRequirements:profile?.dietaryRequirements||member.dietaryRequirements||'To be confirmed'};
  });
};
const loadMenuAttachments = async value => {
  if (!value) return [];
  try {
    const url = new URL(value);
    const cloudName = cloudinary.config().cloud_name;
    const prefix = `/${cloudName}/raw/upload/`;
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || url.port || url.search || url.hash || !url.pathname.startsWith(prefix)) return [];
    const asset = url.pathname.slice(prefix.length).match(/^v\d+\/(menus\/[^/]+|event-sheets\/docs\/[^/]+)$/)?.[1];
    if (!asset) return [];
    const download = cloudinary.utils.private_download_url(decodeURIComponent(asset), null, {
      resource_type:'raw',type:'upload',expires_at:Math.floor(Date.now()/1000)+300,
    });
    const result = await axios.get(download,{responseType:'arraybuffer',timeout:10000,maxRedirects:0,maxContentLength:20*1024*1024});
    const type = result.headers['content-type'] || 'application/octet-stream';
    const extension = type.includes('pdf')?'pdf':type.includes('wordprocessingml')?'docx':type.includes('msword')?'doc':type.includes('png')?'png':type.includes('jpeg')?'jpg':type.includes('webp')?'webp':'bin';
    return [{filename:`menu.${extension}`,content:Buffer.from(result.data),contentType:type}];
  } catch (error) { console.warn('Uploaded menu could not be attached; retaining its link:',error.message); return []; }
};
const cateringHandlers = createCateringHandlers({
  findBooking:query=>Booking.findOne(query).lean(),loadRoster:loadConfirmedCateringRoster,mailer:sendEmail,loadMenuAttachments,
});
export const sendMenuToBand = cateringHandlers.sendMenuToBand;
export const sendDietaryToCaterer = cateringHandlers.sendDietaryToCaterer;

// Disabled pending a separate review of venue document-signing workflow.
// Never fetch a request-supplied URL or send an attachment from this endpoint.
export const docSigningRequest = (_req, res) => res.status(503).json({
  success: false,
  message: "Document-signing email requests are temporarily unavailable. Please contact the TSC team.",
});
