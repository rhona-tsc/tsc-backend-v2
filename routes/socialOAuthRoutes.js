import express from "express";
import jwt from "jsonwebtoken";
import musicianAuth from "../middleware/musicianAuth.js";
import musicianModel from "../models/musicianModel.js";
import {
  decryptSocialToken,
  encryptSocialToken,
} from "../utils/socialTokenCrypto.js";

const router = express.Router();
const API_BASE = String(
  process.env.SOCIAL_OAUTH_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    "https://tsc-backend-v2.onrender.com",
).replace(/\/+$/, "");
const DASHBOARD_URL = String(
  process.env.SOCIAL_OAUTH_DASHBOARD_URL ||
    "https://admin.thesupremecollective.co.uk/musician-dashboard",
);
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

const providerConfig = {
  meta: {
    clientId: () => process.env.META_APP_ID,
    clientSecret: () => process.env.META_APP_SECRET,
    callback: `${API_BASE}/api/social-oauth/meta/callback`,
  },
  tiktok: {
    clientId: () => process.env.TIKTOK_CLIENT_KEY,
    clientSecret: () => process.env.TIKTOK_CLIENT_SECRET,
    callback: `${API_BASE}/api/social-oauth/tiktok/callback`,
  },
};

const oauthState = (provider, musicianId) =>
  jwt.sign(
    { provider, musicianId: String(musicianId), purpose: "social_oauth" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

const redirectResult = (res, provider, result, detail = "") => {
  const target = new URL(DASHBOARD_URL);
  target.searchParams.set("socialProvider", provider);
  target.searchParams.set("socialResult", result);
  if (detail) target.searchParams.set("socialDetail", detail.slice(0, 160));
  return res.redirect(target.toString());
};

const getJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok || body?.error) {
    const message =
      body?.error_description ||
      body?.error?.message ||
      body?.message ||
      `Provider request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
};

router.get("/status", musicianAuth, async (req, res) => {
  const musician = await musicianModel
    .findById(req.userId)
    .select("socialFeedConnectionPreference socialConnections")
    .lean();
  if (!musician) return res.status(404).json({ success: false, message: "Musician not found" });

  return res.json({
    success: true,
    preference: musician.socialFeedConnectionPreference || "undecided",
    providers: {
      meta: {
        configured: Boolean(providerConfig.meta.clientId() && providerConfig.meta.clientSecret()),
        connected: Boolean(musician.socialConnections?.meta?.connected),
        connectedAt: musician.socialConnections?.meta?.connectedAt || null,
        lastSyncedAt: musician.socialConnections?.meta?.lastSyncedAt || null,
      },
      tiktok: {
        configured: Boolean(providerConfig.tiktok.clientId() && providerConfig.tiktok.clientSecret()),
        connected: Boolean(musician.socialConnections?.tiktok?.connected),
        connectedAt: musician.socialConnections?.tiktok?.connectedAt || null,
        lastSyncedAt: musician.socialConnections?.tiktok?.lastSyncedAt || null,
      },
    },
    callbacks: {
      meta: providerConfig.meta.callback,
      tiktok: providerConfig.tiktok.callback,
    },
  });
});

router.get("/:provider/start", musicianAuth, async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const config = providerConfig[provider];
  if (!config) return res.status(404).json({ success: false, message: "Unknown social provider" });
  if (!config.clientId() || !config.clientSecret()) {
    return res.status(503).json({ success: false, message: `${provider} connection is not configured yet` });
  }

  const state = oauthState(provider, req.userId);
  let authUrl;
  if (provider === "meta") {
    authUrl = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    authUrl.searchParams.set("client_id", config.clientId());
    authUrl.searchParams.set("redirect_uri", config.callback);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set(
      "scope",
      process.env.META_SOCIAL_SCOPES ||
        "pages_show_list,pages_read_engagement,instagram_basic",
    );
  } else {
    authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authUrl.searchParams.set("client_key", config.clientId());
    authUrl.searchParams.set("redirect_uri", config.callback);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "user.info.basic,video.list");
    authUrl.searchParams.set("state", state);
  }

  return res.json({ success: true, provider, authUrl: authUrl.toString() });
});

router.get("/meta/callback", async (req, res) => {
  try {
    const state = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET);
    if (state?.purpose !== "social_oauth" || state?.provider !== "meta") throw new Error("Invalid OAuth state");
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));

    const config = providerConfig.meta;
    const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", config.clientId());
    tokenUrl.searchParams.set("client_secret", config.clientSecret());
    tokenUrl.searchParams.set("redirect_uri", config.callback);
    tokenUrl.searchParams.set("code", String(req.query.code || ""));
    const shortToken = await getJson(tokenUrl);

    const longUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", config.clientId());
    longUrl.searchParams.set("client_secret", config.clientSecret());
    longUrl.searchParams.set("fb_exchange_token", shortToken.access_token);
    const token = await getJson(longUrl);

    const pagesUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account");
    pagesUrl.searchParams.set("access_token", token.access_token);
    const pages = await getJson(pagesUrl);
    const page = (pages.data || []).find((item) => item.instagram_business_account?.id) || pages.data?.[0];

    await musicianModel.findByIdAndUpdate(state.musicianId, {
      $set: {
        "socialConnections.meta.connected": true,
        "socialConnections.meta.accountId": page?.instagram_business_account?.id || "",
        "socialConnections.meta.pageId": page?.id || "",
        "socialConnections.meta.accessTokenEncrypted": encryptSocialToken(page?.access_token || token.access_token),
        "socialConnections.meta.scopes": String(process.env.META_SOCIAL_SCOPES || "pages_show_list,pages_read_engagement,instagram_basic").split(","),
        "socialConnections.meta.expiresAt": token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null,
        "socialConnections.meta.connectedAt": new Date(),
        "socialConnections.meta.lastSyncError": "",
        socialFeedConnectionPreference: "connected",
        socialFeedPreferenceUpdatedAt: new Date(),
      },
    });
    return redirectResult(res, "meta", "connected");
  } catch (error) {
    return redirectResult(res, "meta", "error", error.message);
  }
});

router.get("/tiktok/callback", async (req, res) => {
  try {
    const state = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET);
    if (state?.purpose !== "social_oauth" || state?.provider !== "tiktok") throw new Error("Invalid OAuth state");
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const config = providerConfig.tiktok;
    const body = new URLSearchParams({
      client_key: config.clientId(),
      client_secret: config.clientSecret(),
      code: String(req.query.code || ""),
      grant_type: "authorization_code",
      redirect_uri: config.callback,
    });
    const token = await getJson("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    await musicianModel.findByIdAndUpdate(state.musicianId, {
      $set: {
        "socialConnections.tiktok.connected": true,
        "socialConnections.tiktok.accountId": token.open_id || "",
        "socialConnections.tiktok.accessTokenEncrypted": encryptSocialToken(token.access_token),
        "socialConnections.tiktok.refreshTokenEncrypted": encryptSocialToken(token.refresh_token),
        "socialConnections.tiktok.scopes": String(token.scope || "").split(",").filter(Boolean),
        "socialConnections.tiktok.expiresAt": new Date(Date.now() + Number(token.expires_in || 0) * 1000),
        "socialConnections.tiktok.refreshExpiresAt": new Date(Date.now() + Number(token.refresh_expires_in || 0) * 1000),
        "socialConnections.tiktok.connectedAt": new Date(),
        "socialConnections.tiktok.lastSyncError": "",
        socialFeedConnectionPreference: "connected",
        socialFeedPreferenceUpdatedAt: new Date(),
      },
    });
    return redirectResult(res, "tiktok", "connected");
  } catch (error) {
    return redirectResult(res, "tiktok", "error", error.message);
  }
});

router.post("/:provider/sync", musicianAuth, async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  try {
    const musician = await musicianModel
      .findById(req.userId)
      .select("+socialConnections.meta.accessTokenEncrypted +socialConnections.tiktok.accessTokenEncrypted socialConnections socialHighlightPostLinks");
    if (!musician) return res.status(404).json({ success: false, message: "Musician not found" });

    let posts = [];
    if (provider === "tiktok") {
      const token = decryptSocialToken(musician.socialConnections?.tiktok?.accessTokenEncrypted);
      if (!token) throw new Error("TikTok is not connected");
      const data = await getJson(
        "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,embed_link",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ max_count: 12 }),
        },
      );
      posts = (data.data?.videos || []).map((video) => ({
        title: "",
        tag: String(video.title || "").slice(0, 60),
        url: "",
        mediaUrl: video.embed_link ? `${video.embed_link}${video.embed_link.includes("?") ? "&" : "?"}hide_author=1` : "",
        thumbnailUrl: video.cover_image_url || "",
        mediaType: video.embed_link ? "embed" : "image",
        platform: "tiktok",
        visible: true,
        importedAt: new Date(),
      }));
    } else if (provider === "meta") {
      const connection = musician.socialConnections?.meta;
      const token = decryptSocialToken(connection?.accessTokenEncrypted);
      if (!token || !connection?.accountId) throw new Error("Instagram is not connected to an eligible Facebook Page");
      const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${connection.accountId}/media`);
      url.searchParams.set("fields", "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp");
      url.searchParams.set("limit", "12");
      url.searchParams.set("access_token", token);
      const data = await getJson(url);
      posts = (data.data || []).map((media) => ({
        title: "",
        tag: "Performance highlight",
        url: media.permalink || "",
        mediaUrl: media.media_url || "",
        thumbnailUrl: media.thumbnail_url || "",
        mediaType: String(media.media_type || "").toLowerCase() === "video" ? "video" : "image",
        platform: "instagram",
        visible: true,
        importedAt: new Date(),
      }));
    } else {
      return res.status(404).json({ success: false, message: "Unknown social provider" });
    }

    const manualPosts = (musician.socialHighlightPostLinks || []).filter((post) => !post.importedAt);
    musician.socialHighlightPostLinks = [...manualPosts, ...posts];
    musician.socialConnections[provider].lastSyncedAt = new Date();
    musician.socialConnections[provider].lastSyncError = "";
    await musician.save();
    return res.json({ success: true, provider, importedCount: posts.length });
  } catch (error) {
    await musicianModel.findByIdAndUpdate(req.userId, {
      $set: { [`socialConnections.${provider}.lastSyncError`]: error.message },
    }).catch(() => {});
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.delete("/:provider", musicianAuth, async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!providerConfig[provider]) return res.status(404).json({ success: false, message: "Unknown social provider" });
  await musicianModel.findByIdAndUpdate(req.userId, {
    $set: { [`socialConnections.${provider}`]: {} },
  });
  return res.json({ success: true, provider, connected: false });
});

export default router;
