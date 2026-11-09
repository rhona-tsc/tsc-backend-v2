// Keep image snapshots on our media host: provider CDN URLs can expire.
export async function buildInstagramHighlights(media, { musicianId, upload }) {
  const posts = [];
  for (const item of media) {
    const isVideo = String(item.media_type).toUpperCase() === "VIDEO";
    const source = isVideo ? item.thumbnail_url : item.media_url;
    if (!source) continue;
    const url = new URL(source);
    if (url.protocol !== "https:" || !/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) {
      throw new Error("Instagram returned an unsupported image host");
    }
    const image = await upload(source, {
      resource_type: "image",
      public_id: `musicians/${musicianId}/social/instagram/${item.id}`,
      overwrite: true,
    });
    if (!image.secure_url) throw new Error("Instagram image could not be saved");
    posts.push({
      title: "", tag: "Performance highlight", url: "",
      mediaUrl: image.secure_url, thumbnailUrl: image.secure_url,
      mediaType: "image", platform: "instagram", visible: true,
      importedAt: new Date(), moderationStatus: "approved", moderatedAt: new Date(),
    });
  }
  if (media.length && !posts.length) throw new Error("Instagram returned no importable photos or video thumbnails");
  return posts;
}
