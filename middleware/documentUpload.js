import multer from "multer";
import path from "node:path";

export const DOCUMENT_UPLOAD_LIMIT = 20 * 1024 * 1024;
const allowedTypes = new Map([
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".jpg", ["image/jpeg"]], [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]], [".webp", ["image/webp"]],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_UPLOAD_LIMIT, files: 1, fields: 10, parts: 11 },
  fileFilter(_req, file, done) {
    const types = allowedTypes.get(path.extname(file.originalname).toLowerCase());
    if (!types?.includes(file.mimetype)) {
      const error = new Error("Please upload a PDF, Word document, JPEG, PNG or WebP image.");
      error.status = 415;
      return done(error);
    }
    done(null, true);
  },
}).single("file");

export default function documentUpload(req, res, next) {
  upload(req, res, error => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : error.status || 400).json({
      success: false,
      message: tooLarge ? "Please choose a file smaller than 20 MB." : error.message,
    });
  });
}
