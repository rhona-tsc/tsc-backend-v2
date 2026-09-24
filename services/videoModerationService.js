const DIRECT_MEDIA_RE = /\.(mp4|mov|m4v|webm|avi|mpeg|mpg)(?:$|[?#])/i;

const getDriveId = (url) =>
  url.match(/\/file\/d\/([^/?#]+)/i)?.[1] ||
  url.match(/[?&]id=([^&#]+)/i)?.[1] ||
  "";

export const classifyVideoUrl = (raw = "") => {
  const value = String(raw || "").trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { provider: "unknown", automationEligible: false, reason: "Invalid video URL" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com")) {
    return { provider: "youtube", automationEligible: false, reason: "YouTube videos require manual review" };
  }
  if (host.endsWith("vimeo.com")) {
    return { provider: "vimeo", automationEligible: false, reason: "Vimeo page links require manual review or an authorised direct file URL" };
  }
  if (host === "drive.google.com" || host.endsWith("googleusercontent.com")) {
    if (/\/folders\//i.test(parsed.pathname)) {
      return { provider: "google_drive", automationEligible: false, accessStatus: "folder_link", reason: "Select an individual video rather than a Drive folder" };
    }
    const id = getDriveId(value);
    if (!id) return { provider: "google_drive", automationEligible: false, reason: "Could not identify the Drive file" };
    return {
      provider: "google_drive",
      automationEligible: true,
      resolvedMediaUrl: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
      reason: "Drive file will be checked for public download access",
    };
  }
  if (host === "dropbox.com" || host.endsWith("dropboxusercontent.com")) {
    parsed.searchParams.delete("dl");
    parsed.searchParams.set("raw", "1");
    return { provider: "dropbox", automationEligible: true, resolvedMediaUrl: parsed.toString(), reason: "Dropbox file will be checked for public download access" };
  }
  if (host.endsWith("instagram.com")) return { provider: "instagram", automationEligible: false, reason: "Instagram posts require manual review" };
  if (host.endsWith("tiktok.com")) return { provider: "tiktok", automationEligible: false, reason: "TikTok posts require manual review" };
  if (host.endsWith("facebook.com") || host === "fb.watch") return { provider: "facebook", automationEligible: false, reason: "Facebook posts require manual review" };
  if (parsed.protocol === "https:" && DIRECT_MEDIA_RE.test(value)) {
    return { provider: "direct", automationEligible: true, resolvedMediaUrl: value, reason: "Direct media file" };
  }
  return { provider: "unknown", automationEligible: false, reason: "Use a direct video file URL, public Drive/Dropbox file, or review this link manually" };
};

const azureSettings = () => ({
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  resourceGroup: process.env.AZURE_RESOURCE_GROUP,
  accountName: process.env.AZURE_VIDEO_INDEXER_ACCOUNT_NAME,
  accountId: process.env.AZURE_VIDEO_INDEXER_ACCOUNT_ID,
  location: String(process.env.AZURE_VIDEO_INDEXER_LOCATION || "").replace(/\s+/g, "").toLowerCase(),
  tenantId: process.env.AZURE_TENANT_ID,
  clientId: process.env.AZURE_CLIENT_ID,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
});

const requireAzureSettings = () => {
  const settings = azureSettings();
  const missing = Object.entries(settings).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Azure Video Indexer is not configured (${missing.join(", ")})`);
  return settings;
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `Request failed (${response.status})`);
  return body;
};

const getAzureTokens = async () => {
  const settings = requireAzureSettings();
  const oauthBody = new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    grant_type: "client_credentials",
    scope: "https://management.azure.com/.default",
  });
  const oauth = await fetchJson(`https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: oauthBody,
  });
  const armUrl = `https://management.azure.com/subscriptions/${settings.subscriptionId}/resourceGroups/${settings.resourceGroup}/providers/Microsoft.VideoIndexer/accounts/${settings.accountName}/generateAccessToken?api-version=2025-04-01`;
  const vi = await fetchJson(armUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${oauth.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ permissionType: "Contributor", scope: "Account" }),
  });
  return { settings, accessToken: vi.accessToken };
};

export const submitVideoToAzure = async ({ mediaUrl, name }) => {
  const { settings, accessToken } = await getAzureTokens();
  const url = new URL(`https://api.videoindexer.ai/${settings.location}/Accounts/${settings.accountId}/Videos`);
  url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("name", String(name || "Musician video").slice(0, 80));
  url.searchParams.set("videoUrl", mediaUrl);
  url.searchParams.set("privacy", "Private");
  return fetchJson(url, { method: "POST" });
};

export const getAzureVideoIndex = async (videoId) => {
  const { settings, accessToken } = await getAzureTokens();
  const url = new URL(`https://api.videoindexer.ai/${settings.location}/Accounts/${settings.accountId}/Videos/${videoId}/Index`);
  url.searchParams.set("accessToken", accessToken);
  return fetchJson(url);
};

const uniqueFlags = (flags) => [...new Map(flags.map((flag) => [`${flag.type}:${flag.evidence.toLowerCase()}`, flag])).values()];

export const extractModerationFlags = (index = {}) => {
  const insights = index?.videos?.[0]?.insights || {};
  const text = [
    ...(insights.transcript || []).map((item) => item.text),
    ...(insights.ocr || []).map((item) => item.text),
  ].filter(Boolean).join(" \n");
  const flags = [];
  const addMatches = (regex, type, label, severity = "high") => {
    for (const match of text.matchAll(regex)) flags.push({ type, label, severity, evidence: match[0].slice(0, 180) });
  };
  addMatches(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "email", "Email address detected");
  addMatches(/(?:\+44\s?\d{4}|\(?0\d{3,4}\)?)\s?\d{3,4}\s?\d{3,4}/g, "phone", "Phone number detected");
  addMatches(/(?:https?:\/\/|www\.)[^\s]+/gi, "website", "Website detected");
  addMatches(/@[a-z0-9._]{3,}/gi, "social_handle", "Social handle detected", "warning");
  for (const person of insights.namedPeople || []) if (person.name) flags.push({ type: "person_name", label: "Full name may be visible or spoken", severity: "warning", evidence: person.name });
  for (const brand of insights.brands || []) if (brand.name) flags.push({ type: "brand_name", label: "Band or brand name may be visible or spoken", severity: "warning", evidence: brand.name });
  return uniqueFlags(flags);
};
