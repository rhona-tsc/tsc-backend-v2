import multer from "multer";
import path from "node:path";

export default function financeUpload(extension) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 20, parts: 21 },
    fileFilter(_req, file, done) {
      if (path.extname(file.originalname).toLowerCase() !== extension) {
        const error = new Error(`Please upload a ${extension} file.`);
        error.status = 415;
        return done(error);
      }
      done(null, true);
    },
  });
}
