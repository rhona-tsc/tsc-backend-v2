import { v2 as cloudinary } from "cloudinary";

const generating = new Map();
export const THUMBNAIL_TRANSFORM = { width: 640, height: 360, crop: "fill", start_offset: "auto", format: "jpg" };

export const thumbnailMediaUrl = async (submission) => {
  if (submission.thumbnailPublicId) {
    return cloudinary.utils.private_download_url(submission.thumbnailPublicId, submission.thumbnailFormat || "jpg", {
      resource_type: "image", type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 300,
    });
  }
  if (submission.generatedThumbnailUrl) return submission.generatedThumbnailUrl;
  const key = submission.cloudinaryPublicId;
  if (!generating.has(key)) {
    generating.set(key, (async () => {
      const result = await cloudinary.uploader.explicit(key, {
        resource_type: "video", type: "authenticated", eager: [THUMBNAIL_TRANSFORM], eager_async: false,
      });
      const url = result.eager?.[0]?.secure_url;
      if (!url) throw new Error("Video thumbnail is not ready yet");
      return url;
    })().finally(() => generating.delete(key)));
  }
  const url = await generating.get(key);
  submission.generatedThumbnailUrl = url;
  await submission.save();
  return url;
};

export const uploadPrivateThumbnail = (file, musicianId) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    folder: `musician-video-thumbnails/${musicianId}`, resource_type: "image", type: "authenticated",
    unique_filename: true, use_filename: false, format: "jpg",
    transformation: [{ width: 1280, height: 720, crop: "fill", quality: 85 }],
  }, (error, result) => error ? reject(error) : resolve(result));
  stream.end(file.buffer);
});

export const isSupportedThumbnail = (file) => {
  const b = file?.buffer;
  if (!Buffer.isBuffer(b)) return false;
  return (file.mimetype === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || (file.mimetype === "image/png" && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    || (file.mimetype === "image/webp" && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP");
};
