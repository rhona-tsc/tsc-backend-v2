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

export const setYoutubeVideoThumbnail = async ({ videoId, mediaUrl }) => {
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new Error("Could not read the video thumbnail");
  await getYoutube().thumbnails.set({ videoId, media: { mimeType: "image/jpeg", body: Readable.fromWeb(response.body) } });
};

const clean = (value = "") => String(value || "").replace(/\s+/g, " ").trim();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SITE = "https://thesupremecollective.co.uk";
export const youtubeVisibility = musician => musician?.privateTestProfile ? "private" : "unlisted";
export const isVocalist = musician => {
  const types = Array.isArray(musician?.vocals?.type) ? musician.vocals.type : [musician?.vocals?.type || ''];
  return types.some(type => /vocal|singer|rapper/i.test(type) && !/don.t sing/i.test(type)) || (musician?.instrumentation || []).some(i => /vocal|sing|rap/i.test(i.instrument || ''));
};
export const publicMusicianRole = musician => {
  const instruments = (musician?.instrumentation || []).map(i => clean(i.instrument)).filter(Boolean);
  const roles = instruments.map(i => /bass/i.test(i) ? "Bassist" : /guitar/i.test(i) ? "Guitarist" : /drum/i.test(i) ? "Drummer" : /key|piano/i.test(i) ? "Keyboardist" : /sax/i.test(i) ? "Saxophonist" : /vocal|sing/i.test(i) ? "Vocalist" : i);
  if (isVocalist(musician) && !roles.includes("Vocalist")) roles.unshift("Vocalist");
  return [...new Set(roles)].slice(0, 3).join(" / ") || "Musician";
};
export const buildAnonymousYoutubeMetadata = ({ musician, submission, bands = [] }) => {
  const firstName = clean(musician?.firstName || "Musician");
  const lastName = clean(musician?.lastName || "");
  const displayName = `${firstName}${lastName ? ` ${lastName.charAt(0).toUpperCase()}` : ""}`;
  const anonymise = value => {
    let text = String(value || "").replace(/<[^>]*>/g, "").replace(/\*\*/g, "");
    if (lastName) text = text.replace(new RegExp(`\\b${escapeRegex(lastName)}\\b`, "gi"), lastName[0].toUpperCase());
    return text.replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[a-z0-9_.]+/gi, "").replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "").trim();
  };
  const role = publicMusicianRole(musician);
  const supplied = clean(submission.suppliedTitle);
  const safeTitle = supplied && supplied.length <= 65 && !/https?:|www\.|@|\d{6}|\.(mp4|mov|webm)|whatsapp|test|screenshot/i.test(supplied) && anonymise(supplied) === supplied;
  const title = `${displayName} | ${role} | ${safeTitle ? supplied : "Promo Footage"}`.slice(0, 100);
  const profileUrl = `${SITE}/musician/${encodeURIComponent(musician.musicianSlug || String(musician._id))}`;
  const contact = `Bookings & enquiries — The Supreme Collective\nEmail: hello@thesupremecollective.co.uk\nPhone / WhatsApp: +44 7594 223200\n${SITE}/contact`;
  const uniqueBands = [...new Map(bands.filter(b => b.name && b.href?.startsWith('/act/')).map(b => [b.href, b])).values()];
  const links = uniqueBands.slice(0, 25).map(b => `${clean(b.name)}: ${SITE}${b.href}`).join("\n");
  const ending = [`View ${displayName}'s profile and more performances:\n${profileUrl}`, links ? `Performs with The Supreme Collective bands:\n${links}` : "", contact].filter(Boolean).join("\n\n");
  const intro = `${displayName} | ${role} — presented by The Supreme Collective.`;
  const bio = anonymise(musician.tscApprovedBio || musician.bio || "");
  const description = [intro, bio.slice(0, Math.max(0, 4900 - intro.length - ending.length)), ending].filter(Boolean).join("\n\n");
  const candidates = ["The Supreme Collective", displayName, role, ...role.split(" / "), "live music", "live performance", submission.category === "original" ? "original music" : "function band", "wedding entertainment", "corporate entertainment", ...uniqueBands.map(b => b.name), ...(musician.vocals?.genres || [])];
  const tags = []; let budget = 0;
  for (const value of [...new Set(candidates.map(clean).filter(Boolean))]) {
    const cost = value.length + 1 + (/\s/.test(value) ? 2 : 0);
    if (value.length > 60 || budget + cost > 470) continue;
    tags.push(value); budget += cost;
  }
  return { title, description, tags };
};
const snippet = metadata => ({ title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId: "10" });
export const updateYoutubeVideoMetadata = async ({ videoId, metadata, privacyStatus }) => {
  const result = await getYoutube().videos.update({ part: ["snippet", "status"], requestBody: { id: videoId, snippet: snippet(metadata), status: { privacyStatus, embeddable: true, selfDeclaredMadeForKids: false } } });
  if (result.data?.status?.privacyStatus !== privacyStatus) throw new Error(`YouTube has not applied the requested ${privacyStatus} visibility`);
  return result.data;
};
export const publishVideoToYoutube = async ({ mediaUrl, metadata, privacyStatus = "unlisted" }) => {
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error(`Could not read staged video (${response.status})`);
  const result = await getYoutube().videos.insert({
    part: ["snippet", "status"],
    requestBody: { snippet: snippet(metadata), status: { privacyStatus, embeddable: true, selfDeclaredMadeForKids: false } },
    media: { mimeType: response.headers.get("content-type") || "video/mp4", body: Readable.fromWeb(response.body) },
  });
  if (!result.data?.id) throw new Error("YouTube did not return a video id");
  return { id: result.data.id, url: `https://youtu.be/${result.data.id}`, privacyStatus: result.data.status?.privacyStatus || "unknown" };
};
