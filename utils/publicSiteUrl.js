const LIVE_PUBLIC_SITE = "https://thesupremecollective.co.uk";

const normalisePublicOrigin = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local")) return "";
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return "";
  }
};

export const getPublicSiteBaseUrl = () => {
  const candidates = [
    process.env.PUBLIC_SITE_URL,
    process.env.PUBLIC_FRONTEND_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.FRONTEND_BASE_URL,
  ];
  return candidates.map(normalisePublicOrigin).find(Boolean) || LIVE_PUBLIC_SITE;
};

export const buildEventSheetUrl = (bookingRef) =>
  `${getPublicSiteBaseUrl()}/event-sheet/${encodeURIComponent(String(bookingRef || ""))}`;

export { LIVE_PUBLIC_SITE };
