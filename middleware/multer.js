import multer from 'multer';

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
  },
});

console.log("✅ Multer configuration set up with 100MB memory storage limit");

export default upload;