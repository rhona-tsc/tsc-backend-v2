import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import { v4 as uuidv4 } from "uuid";

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_SECRET_KEY,
});

export const uploader = async (fileBuffer, originalName = "upload.jpg", folder = "uploads") => {
  if (!fileBuffer) throw new Error("uploader: fileBuffer is required");

  const extension = originalName.split('.').pop().toLowerCase();
  let resourceType = "image";
  if (["mp3", "wav", "ogg", "aac", "flac", "aiff", "m4a"].includes(extension)) {
    resourceType = "video"; // Cloudinary uses "video" for audio files too
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: uuidv4(),
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(fileBuffer);
  });

  return result;
};


