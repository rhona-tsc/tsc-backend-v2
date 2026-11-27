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

export const docSigningRequest = async (req, res) => {
  try {
    const { bookingId, _id, to, subject, docName, docUrl, venueEmail } = req.body || {};

    const targetTo = (to && Array.isArray(to) ? to : [to]).filter(Boolean);
    const ccVenue = (venueEmail || "").trim();
    const recipients = [...new Set([
      "hello@thesupremecollective.co.uk",
      ...targetTo,
      ...(ccVenue ? [ccVenue] : []),
    ])];

    const ref = bookingId || _id || "Unknown booking";
    const emailSubject = subject || `Doc signing requested – ${ref}`;

    const attachments = [];
    let bodyNote = "";

    if (docUrl && /^https?:\/\//i.test(docUrl)) {
      try {
        const resp = await axios.get(docUrl, { responseType: "arraybuffer" });
        const contentType = resp.headers["content-type"] || "application/pdf";
        attachments.push({
          filename: docName || "document.pdf",
          content: Buffer.from(resp.data),
          contentType,
        });
        bodyNote = `<p>Document attached: <strong>${docName || "file"}</strong></p>`;
      } catch (e) {
        console.warn("Could not fetch document to attach; including link:", e?.message);
        bodyNote = `<p>Document link: <a href="${docUrl}" target="_blank" rel="noreferrer">${docName || docUrl}</a></p>`;
      }
    } else if (docUrl) {
      bodyNote = `<p>Document: <code>${docUrl}</code></p>`;
    }

    const html = `
      <p>Hi team,</p>
      <p>This is the TSC Event Sheet Bot here 👋. The client has requested band signatures on this document for their venue (that may be in cc).</p>
      <ul>
        <li><strong>Booking ref:</strong> ${ref}</li>
      </ul>
      <p>The TSC Team will follow up to confirm when signed.</p>
      ${bodyNote}
      <p>Thanks,<br/>TSC Event Sheet Bot</p>
    `;

    const result = await sendEmail({to:recipients, subject:emailSubject, html, attachments});
    if (!result?.ok) {
      return res.status(500).json({ success: false, message: "Email send failed", error: result?.error?.message });
    }
    return res.status(200).json({ success: true, queued: false });
  } catch (err) {
    console.error("docSigningRequest error:", err);
    return res.status(500).json({ success: false, message: "Failed to send doc-signing email." });
  }
};
