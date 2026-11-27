// routes/upload.js
import express from "express";
import requireAnyAuth from "../middleware/requireAnyAuth.js";
import documentUpload from "../middleware/documentUpload.js";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import eventSheetUploadAccess from '../middleware/eventSheetUploadAccess.js';
import requireStaffAuth from '../middleware/requireStaffAuth.js';
import Booking from '../models/bookingModel.js';
import mongoose from 'mongoose';
import {ensureClientUploadLink} from '../services/eventSheetUploadGrantService.js';

const router = express.Router();
router.post('/event-sheet/:bookingId/client-link',requireStaffAuth,async(req,res)=>{
 try{
  const ref=String(req.params.bookingId).trim();
  const booking=await Booking.findOne(mongoose.isValidObjectId(ref)?{$or:[{_id:ref},{bookingId:ref}]}:{bookingId:ref}).select('_id bookingId eventDateISO date').lean();
  if(!booking)return res.status(404).json({success:false,message:'Booking not found.'});
  res.set('Cache-Control','no-store');res.json({success:true,url:await ensureClientUploadLink(booking)});
 }catch{return res.status(400).json({success:false,message:'A secure link could not be created. Please contact the TSC team.'});}
});
// Authorize this specific booking before accepting any file bytes.
router.get('/event-sheet/:bookingId/access', eventSheetUploadAccess, (req,res)=>res.json({success:true,allowed:true,canShareClientLink:req.user?.role==='agent'}));
router.post('/event-sheet/:bookingId/doc', eventSheetUploadAccess, documentUpload, (req,res)=>{
  if (!req.file) return res.status(400).json({success:false,message:'Please choose a file to upload.'});
  const file=req.file;
  if (!file.size) return res.status(400).json({success:false,message:'Please choose a non-empty file.'});
  const publicId=`${req.uploadBooking._id}_${randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
  const stream=cloudinary.uploader.upload_stream({resource_type:'raw',folder:'event-sheets/docs',public_id:publicId},(error,uploaded)=>{
    if(error) return res.status(502).json({success:false,message:'The file could not be stored. Please try again shortly.'});
    console.info('event_sheet_upload', {bookingId:String(req.uploadBooking._id),actorId:String(req.user.id||req.user.userId||''),at:new Date().toISOString()});
    res.json({success:true,url:uploaded.secure_url,public_id:uploaded.public_id,bytes:uploaded.bytes,originalName:file.originalname});
  });
  Readable.from(file.buffer).pipe(stream);
});
router.use(requireAnyAuth);

router.post("/menu", documentUpload, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", folder: "menus" },
      (err, uploaded) => {
        if (err) {
          return res.status(500).json({ success: false, message: err.message });
        }
        return res.json({ success: true, url: uploaded.secure_url });
      }
    );

    // Pipe the in-memory buffer to Cloudinary without streamifier
    Readable.from(file.buffer).pipe(uploadStream);
  } catch (e) {
    console.error("Menu upload failed:", e);
    res.status(500).json({ success: false, message: "Upload error" });
  }
});

router.post("/doc", documentUpload, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const folder = "event-sheets/docs";
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", folder, use_filename: true, unique_filename: true },
      (err, uploaded) => {
        if (err) {
          console.error("Cloudinary upload error:", err);
          return res.status(500).json({ success: false, message: err.message });
        }
        return res.json({
          success: true,
          url: uploaded.secure_url,
          public_id: uploaded.public_id,
          bytes: uploaded.bytes,
          format: uploaded.format,
          originalName: file.originalname,
        });
      }
    );

    Readable.from(file.buffer).pipe(uploadStream);
  } catch (e) {
    console.error("Doc upload failed:", e);
    res.status(500).json({ success: false, message: "Upload error" });
  }
});


export default router;
