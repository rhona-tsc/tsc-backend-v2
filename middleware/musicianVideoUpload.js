import multer from 'multer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

// Keep large multipart files out of the Node heap. Each request gets a private,
// temporary directory, removed on success, validation failure or disconnect.
export function createMusicianVideoUpload({ temporaryRoot = tmpdir(), maxBytes = MAX_VIDEO_BYTES } = {}) {
  const parser = multer({
    storage: multer.diskStorage({
      destination: (req, file, callback) => callback(null, req.videoUploadDirectory),
      filename: (req, file, callback) => callback(null, 'video'),
    }),
    // Busboy emits its limit event at the threshold, so allow the advertised
    // maximum itself and reject the first byte above it.
    limits: { fileSize: maxBytes + 1, files: 1, fields: 4, fieldSize: 8192, parts: 5 },
    fileFilter: (req, file, callback) => {
      if (VIDEO_MIMES.has(file.mimetype)) return callback(null, true);
      const error = new Error('Use an MP4, MOV or WebM video');
      error.code = 'UNSUPPORTED_VIDEO';
      callback(error);
    },
  }).single('video');

  return async (req, res, next) => {
    try {
      req.videoUploadDirectory = await mkdtemp(path.join(temporaryRoot, 'tsc-video-upload-'));
      req.cleanupVideoUpload = () => rm(req.videoUploadDirectory, { recursive: true, force: true });
      const clean = () => { void req.cleanupVideoUpload().catch(error => console.error('Video temporary-file cleanup failed:', error.code)); };
      res.once('finish', clean);
      res.once('close', clean);
      if (req.destroyed || res.destroyed) { await req.cleanupVideoUpload(); return; }
      parser(req, res, async error => {
        if (!error) return next();
        await req.cleanupVideoUpload().catch(cleanupError => console.error('Video temporary-file cleanup failed:', cleanupError.code));
        if (res.destroyed) return;
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.code === 'UNSUPPORTED_VIDEO' ? 415 : error instanceof multer.MulterError ? 400 : 500;
        return res.status(status).json({ success: false, message: status === 413
          ? 'Video must be 100 MB or smaller'
          : status === 415 ? error.message : 'Could not receive the video. Please choose one MP4, MOV or WebM file and try again.' });
      });
    } catch (error) {
      if (req.cleanupVideoUpload) await req.cleanupVideoUpload().catch(() => {});
      next(error);
    }
  };
}

export default createMusicianVideoUpload();
