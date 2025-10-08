// routes/upload.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/menu", upload.single("file"), async (req, res) => {
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

router.post("/doc", upload.single("file"), async (req, res) => {
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