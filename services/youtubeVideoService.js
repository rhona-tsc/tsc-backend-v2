import { Readable } from "node:stream";
import { google } from "googleapis";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`YouTube publishing is not configured (${name})`);
  return value;
};

const getYoutube = () => {
  const oauth = new google.auth.OAuth2(
    required("YOUTUBE_CLIENT_ID"),
    required("YOUTUBE_CLIENT_SECRET"),
    process.env.YOUTUBE_REDIRECT_URI || undefined,
  );
  oauth.setCredentials({ refresh_token: required("YOUTUBE_REFRESH_TOKEN") });
  return google.youtube({ version: "v3", auth: oauth });
};

export const inspectYoutubeVideo = async (videoId) => {
  const youtube = getYoutube();
  const result = await youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
  const video = result.data?.items?.[0];
  if (!video) return null;
  return {
    id: video.id,
    title: video.snippet?.title || "",
    channelId: video.snippet?.channelId || "",
    channelTitle: video.snippet?.channelTitle || "",
    embeddable: video.status?.embeddable !== false,
    privacyStatus: video.status?.privacyStatus || "",
  };
};

const clean = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

export const buildAnonymousYoutubeMetadata = ({ musician, submission }) => {
  const firstName = clean(musician?.firstName || musician?.basicInfo?.firstName || "Musician");
  const lastName = clean(musician?.lastName || musician?.basicInfo?.lastName || "");
  const displayName = `${firstName}${lastName ? ` ${lastName.charAt(0).toUpperCase()}` : ""}`;
  const role = submission.category === "original" ? "Original Artist" : "Professional Vocalist";
  const title = `${displayName} | ${role} | Showreel`.slice(0, 100);
  const description = [
    `${displayName} performing in a showreel presented by The Supreme Collective.`,
    "Available for professional engagements through The Supreme Collective.",
    "This unlisted video is intended for client profile presentation.",
  ].join("\n\n");
  const tags = ["The Supreme Collective", "showreel", "professional musician", submission.category === "original" ? "original artist" : "function musician"];
  return { title, description, tags };
};

export const publishVideoToYoutube = async ({ mediaUrl, metadata }) => {
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error(`Could not read staged video (${response.status})`);
  const youtube = getYoutube();
  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId: "10" },
      status: { privacyStatus: "unlisted", embeddable: true, selfDeclaredMadeForKids: false },
    },
    media: { mimeType: response.headers.get("content-type") || "video/mp4", body: Readable.fromWeb(response.body) },
  });
  if (!result.data?.id) throw new Error("YouTube did not return a video id");
  return { id: result.data.id, url: `https://youtu.be/${result.data.id}` };
};
