import dotenv from 'dotenv';
dotenv.config();

import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_SECRET_KEY,
});

export const uploader = (filePath, folder = "musicians") => {
  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.upload(
      filePath,
      { folder },
      (error, result) => {
        fs.unlinkSync(filePath); // Clean up after upload
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
};


console.log("✅ Connected to Cloudinary");

export default cloudinary; // 👈 EXPORT THE CONFIGURED INSTANCE