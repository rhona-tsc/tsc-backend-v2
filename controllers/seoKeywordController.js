import SeoKeywordSnapshot from "../models/seoKeywordSnapshotModel.js";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import { encryptSocialToken } from "../utils/socialTokenCrypto.js";
import {
  buildSeoSnapshot,
  completedMonthPeriods,
  getOrCreateSeoTracker,
  runSeoMonthlyReport,
  searchConsoleOAuthAvailable,
  searchConsoleOAuthCallback,
  searchConsoleConfigured,
  sendSeoSnapshotEmail,
} from "../services/seoKeywordService.js";

const cleanEmail = (value) => String(value || "").trim().toLowerCase();

export const getSeoKeywordTracker = async (_req, res) => {
  try {
    const tracker = await getOrCreateSeoTracker();
    const snapshots = await SeoKeywordSnapshot.find({ propertyUrl: tracker.propertyUrl })
      .sort({ periodStart: -1 })
      .limit(12)
      .lean();
    return res.json({
      success: true,
      configured: await searchConsoleConfigured(),
      oauthAvailable: searchConsoleOAuthAvailable(),
      oauthCallback: searchConsoleOAuthCallback(),
      tracker,
      snapshots,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const adminDashboardUrl = () =>
  String(process.env.ADMIN_URL || "https://admin.thesupremecollective.co.uk").replace(/\/+$/, "");

export const startSeoGoogleOAuth = async (req, res) => {
  try {
    if (!searchConsoleOAuthAvailable()) {
      return res.status(503).json({ success: false, message: "Google OAuth is not configured" });
    }
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      searchConsoleOAuthCallback(),
    );
    const state = jwt.sign(
      { purpose: "seo_search_console", email: req.user?.email || "" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    const authUrl = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/webmasters.readonly",
      ],
      state,
    });
    return res.json({ success: true, authUrl });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const completeSeoGoogleOAuth = async (req, res) => {
  const redirect = new URL(`${adminDashboardUrl()}/seo-keywords`);
  try {
    const state = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET);
    if (state?.purpose !== "seo_search_console") throw new Error("Invalid Google connection state");
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      searchConsoleOAuthCallback(),
    );
    const { tokens } = await oauth.getToken(String(req.query.code || ""));
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token; reconnect and approve access again");
    oauth.setCredentials(tokens);
    const profile = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
    const tracker = await getOrCreateSeoTracker();
    tracker.googleConnected = true;
    tracker.googleConnectedAt = new Date();
    tracker.googleAccountEmail = profile.data.email || state.email || "";
    tracker.googleRefreshTokenEncrypted = encryptSocialToken(tokens.refresh_token);
    await tracker.save();
    redirect.searchParams.set("google", "connected");
  } catch (error) {
    redirect.searchParams.set("google", "error");
    redirect.searchParams.set("detail", String(error.message || error).slice(0, 160));
  }
  return res.redirect(redirect.toString());
};

export const updateSeoKeywordTracker = async (req, res) => {
  try {
    const tracker = await getOrCreateSeoTracker();
    const body = req.body || {};
    if (typeof body.propertyUrl === "string" && body.propertyUrl.trim()) {
      tracker.propertyUrl = body.propertyUrl.trim();
    }
    if (Array.isArray(body.recipients)) {
      tracker.recipients = [...new Set(body.recipients.map(cleanEmail).filter(Boolean))];
    }
    if (typeof body.enabled === "boolean") tracker.enabled = body.enabled;
    if (Number.isFinite(Number(body.sendDay))) {
      tracker.sendDay = Math.min(20, Math.max(1, Number(body.sendDay)));
    }
    if (Array.isArray(body.keywords)) {
      const seen = new Set();
      tracker.keywords = body.keywords
        .map((keyword) => ({
          term: String(keyword.term || "").trim(),
          targetUrl: String(keyword.targetUrl || "").trim(),
          source: ["search_console", "google_ads", "manual"].includes(keyword.source)
            ? keyword.source
            : "manual",
          active: keyword.active !== false,
        }))
        .filter((keyword) => {
          const key = keyword.term.toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }
    await tracker.save();
    return res.json({ success: true, tracker });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const refreshSeoKeywordTracker = async (_req, res) => {
  try {
    const tracker = await getOrCreateSeoTracker();
    const snapshot = await buildSeoSnapshot({ tracker });
    tracker.lastRunAt = new Date();
    tracker.lastError = "";
    await tracker.save();
    return res.json({ success: true, snapshot });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const sendSeoKeywordTestEmail = async (_req, res) => {
  try {
    const tracker = await getOrCreateSeoTracker();
    const snapshot = await buildSeoSnapshot({ tracker });
    await sendSeoSnapshotEmail({ tracker, snapshot });
    return res.json({ success: true, snapshot });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const runSeoKeywordCron = async (_req, res) => {
  try {
    const tracker = await getOrCreateSeoTracker();
    const periods = completedMonthPeriods();
    const existing = await SeoKeywordSnapshot.findOne({
      propertyUrl: tracker.propertyUrl,
      periodStart: periods.periodStart,
      emailedAt: { $ne: null },
    }).lean();
    if (existing) {
      return res.json({
        success: true,
        alreadySent: true,
        periodStart: existing.periodStart,
        emailedAt: existing.emailedAt,
      });
    }
    const snapshot = await runSeoMonthlyReport({ sendEmailReport: true });
    return res.json({ success: true, periodStart: snapshot.periodStart, emailedAt: snapshot.emailedAt });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
