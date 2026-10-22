import { google } from "googleapis";
import SeoKeywordTracker from "../models/seoKeywordTrackerModel.js";
import SeoKeywordSnapshot from "../models/seoKeywordSnapshotModel.js";
import sendEmail from "../utils/sendEmail.js";
import { decryptSocialToken } from "../utils/socialTokenCrypto.js";

export const DEFAULT_KEYWORDS = [
  "soul wedding band",
  "funk wedding band",
  "event band",
  "funk wedding bands",
  "motown wedding band",
  "r&b wedding band",
  "4 piece wedding band",
  "office party band",
  "party band uk",
  "soul band london",
  "wedding entertainment",
  "wedding bands near me",
  "premium wedding band",
  "live band with dj",
  "live music for wedding reception",
  "hire bands for party",
  "hire party bands",
  "party band",
  "cover bands near me",
  "band for wedding",
  "band for wedding reception",
  "event band for wedding",
  "wedding band with saxophone",
  "party bands london",
];

const normaliseKeyword = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const isoDate = (date) => date.toISOString().slice(0, 10);

export const completedMonthPeriods = (now = new Date()) => {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(currentMonthStart.getTime() - 86400000);
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  const comparisonEnd = new Date(periodStart.getTime() - 86400000);
  const comparisonStart = new Date(
    Date.UTC(comparisonEnd.getUTCFullYear(), comparisonEnd.getUTCMonth(), 1),
  );
  return {
    periodStart: isoDate(periodStart),
    periodEnd: isoDate(periodEnd),
    comparisonStart: isoDate(comparisonStart),
    comparisonEnd: isoDate(comparisonEnd),
  };
};

const parseCredentials = () => {
  const raw = process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  } catch {
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      return parsed;
    } catch {
      throw new Error("GOOGLE_SEARCH_CONSOLE_CREDENTIALS must be JSON or base64-encoded JSON");
    }
  }
};

export const searchConsoleOAuthCallback = () =>
  process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ||
  `${String(process.env.BACKEND_PUBLIC_URL || "https://tsc2025.onrender.com").replace(/\/+$/, "")}/api/seo-keywords/google/callback`;

export const searchConsoleOAuthAvailable = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const searchConsoleConfigured = async () => {
  if (process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  const tracker = await SeoKeywordTracker.findOne({ key: "primary" })
    .select("+googleRefreshTokenEncrypted")
    .lean();
  return Boolean(tracker?.googleRefreshTokenEncrypted);
};

const getSearchConsole = async () => {
  const credentials = parseCredentials();
  if (credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      ...(credentials ? { credentials } : {}),
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });
    return google.searchconsole({ version: "v1", auth: await auth.getClient() });
  }
  const tracker = await SeoKeywordTracker.findOne({ key: "primary" })
    .select("+googleRefreshTokenEncrypted")
    .lean();
  if (!tracker?.googleRefreshTokenEncrypted) throw new Error("Connect Google Search Console first");
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    searchConsoleOAuthCallback(),
  );
  oauth.setCredentials({ refresh_token: decryptSocialToken(tracker.googleRefreshTokenEncrypted) });
  return google.searchconsole({ version: "v1", auth: oauth });
};

export const getOrCreateSeoTracker = async () => {
  let tracker = await SeoKeywordTracker.findOne({ key: "primary" });
  if (!tracker) {
    tracker = await SeoKeywordTracker.create({
      key: "primary",
      keywords: DEFAULT_KEYWORDS.map((term) => ({ term, source: "manual", active: true })),
    });
  }
  return tracker;
};

const queryPeriod = async ({ propertyUrl, startDate, endDate }) => {
  const searchconsole = await getSearchConsole();
  const response = await searchconsole.searchanalytics.query({
    siteUrl: propertyUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["query", "page"],
      rowLimit: 25000,
      dataState: "final",
      type: "web",
    },
  });
  return response.data.rows || [];
};

const aggregateRows = (rows) => {
  const result = new Map();
  for (const row of rows) {
    const [query = "", page = ""] = row.keys || [];
    const key = normaliseKeyword(query);
    if (!key) continue;
    const current = result.get(key) || {
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
      pages: new Map(),
    };
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    current.clicks += clicks;
    current.impressions += impressions;
    current.weightedPosition += Number(row.position || 0) * impressions;
    const pageMetrics = current.pages.get(page) || { impressions: 0, clicks: 0 };
    pageMetrics.impressions += impressions;
    pageMetrics.clicks += clicks;
    current.pages.set(page, pageMetrics);
    result.set(key, current);
  }
  return result;
};

const metricFor = (map, keyword) => {
  const value = map.get(normaliseKeyword(keyword));
  if (!value || !value.impressions) {
    return { clicks: 0, impressions: 0, ctr: 0, position: null, topPage: "" };
  }
  const topPage = [...value.pages.entries()].sort(
    (a, b) => b[1].impressions - a[1].impressions || b[1].clicks - a[1].clicks,
  )[0]?.[0] || "";
  return {
    clicks: value.clicks,
    impressions: value.impressions,
    ctr: value.impressions ? value.clicks / value.impressions : 0,
    position: value.weightedPosition / value.impressions,
    topPage,
  };
};

const statusFor = ({ impressions, position, previousPosition }) => {
  if (!impressions) return "No impressions yet";
  if (position <= 3) return "Top 3";
  if (position <= 10) return "Page 1";
  if (position <= 20) return "Near page 1";
  if (previousPosition != null && position < previousPosition - 1) return "Improving";
  if (previousPosition != null && position > previousPosition + 1) return "Declining";
  return "Needs optimisation";
};

const actionFor = ({ impressions, position, clicks, targetUrl, topPage }) => {
  if (!targetUrl && !topPage) return "Assign or create a relevant target page";
  if (!impressions) return "Strengthen the target page's relevance for this phrase";
  if (position <= 3 && clicks === 0) return "Improve the search title and description to earn clicks";
  if (position <= 10) return "Protect the ranking and improve click-through rate";
  if (position <= 20) return "Expand the target page and strengthen internal links";
  return "Optimise the target page content and internal links";
};

export const buildSeoSnapshot = async ({ tracker, periods = completedMonthPeriods() }) => {
  if (!(await searchConsoleConfigured())) {
    throw new Error("Search Console credentials are not configured");
  }
  const [currentRows, previousRows] = await Promise.all([
    queryPeriod({
      propertyUrl: tracker.propertyUrl,
      startDate: periods.periodStart,
      endDate: periods.periodEnd,
    }),
    queryPeriod({
      propertyUrl: tracker.propertyUrl,
      startDate: periods.comparisonStart,
      endDate: periods.comparisonEnd,
    }),
  ]);
  const current = aggregateRows(currentRows);
  const previous = aggregateRows(previousRows);
  const rows = tracker.keywords
    .filter((keyword) => keyword.active !== false)
    .map((keyword) => {
      const currentMetric = metricFor(current, keyword.term);
      const previousMetric = metricFor(previous, keyword.term);
      const positionChange =
        currentMetric.position != null && previousMetric.position != null
          ? previousMetric.position - currentMetric.position
          : null;
      const result = {
        keyword: keyword.term,
        targetUrl: keyword.targetUrl || "",
        ...currentMetric,
        previousClicks: previousMetric.clicks,
        previousImpressions: previousMetric.impressions,
        previousPosition: previousMetric.position,
        positionChange,
        status: statusFor({ ...currentMetric, previousPosition: previousMetric.position }),
      };
      result.recommendedAction = actionFor(result);
      return result;
    });

  return SeoKeywordSnapshot.findOneAndUpdate(
    { propertyUrl: tracker.propertyUrl, periodStart: periods.periodStart },
    { ...periods, propertyUrl: tracker.propertyUrl, rows },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);

const formatPosition = (value) => (value == null ? "—" : Number(value).toFixed(1));

export const sendSeoSnapshotEmail = async ({ tracker, snapshot }) => {
  const visible = [...snapshot.rows]
    .sort((a, b) => b.impressions - a.impressions || (a.position ?? 999) - (b.position ?? 999));
  const changed = visible.filter((row) => row.positionChange != null);
  const improving = changed.filter((row) => row.positionChange > 1).length;
  const declining = changed.filter((row) => row.positionChange < -1).length;
  const htmlRows = visible.map((row) => {
    const change = row.positionChange == null
      ? "—"
      : `${row.positionChange > 0 ? "+" : ""}${row.positionChange.toFixed(1)}`;
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.keyword)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${row.impressions}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${row.clicks}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${formatPosition(row.position)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${change}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.status)}</td>
    </tr>`;
  }).join("");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:900px;margin:auto">
      <h1 style="font-size:24px">Monthly SEO keyword report</h1>
      <p>${snapshot.periodStart} to ${snapshot.periodEnd}, compared with ${snapshot.comparisonStart} to ${snapshot.comparisonEnd}.</p>
      <p><strong>${visible.length}</strong> tracked keywords · <strong>${improving}</strong> improving · <strong>${declining}</strong> declining</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#0f172a;color:#fff">
          <th style="padding:8px;text-align:left">Keyword</th><th style="padding:8px;text-align:right">Impressions</th>
          <th style="padding:8px;text-align:right">Clicks</th><th style="padding:8px;text-align:right">Position</th>
          <th style="padding:8px;text-align:right">Change</th><th style="padding:8px;text-align:left">Status</th>
        </tr></thead><tbody>${htmlRows}</tbody>
      </table>
      <p style="color:#64748b;font-size:12px">A positive change means the average position improved. Keywords with no impressions are shown separately from position zero.</p>
    </div>`;
  const recipients = tracker.recipients.filter(Boolean);
  if (!recipients.length) throw new Error("Add at least one monthly report recipient");
  const result = await sendEmail({
    to: recipients,
    subject: `SEO keyword report: ${snapshot.periodStart} to ${snapshot.periodEnd}`,
    html,
  });
  if (!result?.ok) throw new Error(result?.error || "Could not send SEO report email");
  snapshot.emailedAt = new Date();
  await snapshot.save();
  tracker.lastEmailAt = new Date();
  await tracker.save();
};

export const runSeoMonthlyReport = async ({ sendEmailReport = true, skipIfEmailed = false } = {}) => {
  const tracker = await getOrCreateSeoTracker();
  const periods = completedMonthPeriods();
  if (skipIfEmailed) {
    const existing = await SeoKeywordSnapshot.findOne({
      propertyUrl: tracker.propertyUrl,
      periodStart: periods.periodStart,
      emailedAt: { $ne: null },
    });
    if (existing) return existing;
  }
  const snapshot = await buildSeoSnapshot({ tracker, periods });
  tracker.lastRunAt = new Date();
  tracker.lastError = "";
  await tracker.save();
  if (sendEmailReport) await sendSeoSnapshotEmail({ tracker, snapshot });
  return snapshot;
};

let schedulerTimer;
export const startSeoMonthlyScheduler = ({ intervalMs = 60 * 60 * 1000 } = {}) => {
  if (schedulerTimer) return schedulerTimer;
  const check = async () => {
    try {
      const tracker = await getOrCreateSeoTracker();
      if (!tracker.enabled || new Date().getUTCDate() < tracker.sendDay) return;
      const periods = completedMonthPeriods();
      const existing = await SeoKeywordSnapshot.findOne({
        propertyUrl: tracker.propertyUrl,
        periodStart: periods.periodStart,
        emailedAt: { $ne: null },
      }).lean();
      if (!existing) await runSeoMonthlyReport({ sendEmailReport: true, skipIfEmailed: true });
    } catch (error) {
      console.error("SEO monthly scheduler error:", error?.message || error);
      await SeoKeywordTracker.updateOne(
        { key: "primary" },
        { $set: { lastError: error?.message || String(error), lastRunAt: new Date() } },
      ).catch(() => {});
    }
  };
  setTimeout(check, 15000);
  schedulerTimer = setInterval(check, intervalMs);
  schedulerTimer.unref?.();
  return schedulerTimer;
};
