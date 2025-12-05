// utils/pickHeroImage.js
/**
 * Extract a usable image URL from a variety of shapes:
 * - { url: "https://..." }
 * - "https://..."
 * - { public_id: "folder/asset" }
 * If it's a Cloudinary public_id, we build a URL using your env cloud name.
 */
function extractUrl(imgLike) {
  if (!imgLike) return null;

  // String case
  if (typeof imgLike === "string") {
    if (/^https?:\/\//i.test(imgLike)) return imgLike; // already a URL
    return buildCloudinaryUrl(imgLike);                 // assume it's a public_id
  }

  // Object with url
  if (typeof imgLike === "object" && imgLike.url) {
    if (/^https?:\/\//i.test(imgLike.url)) return imgLike.url;
    return buildCloudinaryUrl(imgLike.url || imgLike.public_id || "");
  }

  // Object with public_id
  if (typeof imgLike === "object" && imgLike.public_id) {
    return buildCloudinaryUrl(imgLike.public_id);
  }

  return null;
}

/**
 * Build a Cloudinary URL if we have a cloud name and a plausible public_id.
 * (No transforms added here; keep it generic for re-use.)
 */
function buildCloudinaryUrl(publicId) {
  if (!publicId || /^https?:\/\//i.test(publicId)) return publicId || null;
  const cloudName =
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.REACT_APP_CLOUDINARY_NAME ||
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    "";

  if (!cloudName) return null;
  // Don’t add an extension—Cloudinary handles formats; keep it simple.
  return `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;
}

/**
 * Given an array of image-ish entries, pick the "best" one:
 * Prefer titles containing "hero" or "cover", else first valid.
 */
function pickFromArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;

  // Score by title hint
  let best = null;
  let bestScore = -1;

  for (const item of arr) {
    const url = extractUrl(item);
    if (!url) continue;

    const title = String(item?.title || "").toLowerCase();
    let score = 0;
    if (title.includes("hero")) score += 3;
    if (title.includes("cover")) score += 2;
    if (title.includes("profile")) score += 1;

    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  }

  // Fallback to first valid if no titled winner
  if (!best) {
    for (const item of arr) {
      const url = extractUrl(item);
      if (url) return url;
    }
  }

  return best;
}

/**
 * Main selector used by Act Card upserts.
 * Priority:
 *   1) actDoc.profileImage[]
 *   2) actDoc.coverImage[]
 *   3) actDoc.images[]
 *   4) actDoc.heroImage / actDoc.heroImageUrl (loose compatibility)
 */
export function pickHeroImage(actDoc = {}) {
  // Arrays with {title,url} items are common in your schema
  const fromProfile = pickFromArray(actDoc.profileImage);
  if (fromProfile) return fromProfile;

  const fromCover = pickFromArray(actDoc.coverImage);
  if (fromCover) return fromCover;

  const fromImages = pickFromArray(actDoc.images);
  if (fromImages) return fromImages;

  // Loose single-field fallbacks
  const single =
    extractUrl(actDoc.heroImageUrl) ||
    extractUrl(actDoc.heroImage) ||
    null;

  return single || null;
}

export default pickHeroImage;