import crypto from "node:crypto";
import SeoAiSnapshot from "../models/seoAiSnapshotModel.js";

export const AI_PLATFORMS = ["chatgpt", "google_ai_overview"];
export const AI_ARTIST_NAMES = ["Magnolia Sky", "Gotta Be Garage", "The Riot Dogs", "Funk Royale", "Indigo Delight"];
export const DEFAULT_AI_PROMPTS = [
  ...["Surrey", "Berkshire", "Hertfordshire", "Essex", "Buckinghamshire", "Kent", "West Sussex", "East Sussex", "Oxfordshire"]
    .map(county => `Which live wedding bands can I hire in ${county}?`),
  "Which funk and soul wedding bands can I hire in the UK?",
  "Which live UK garage bands can I book for a wedding?",
];
export const aiVisibilityConfigured = () => Boolean(process.env.SEARCHAPI_API_KEY);
export const normaliseAiPrompts = prompts => [...new Set(
  (Array.isArray(prompts) ? prompts : DEFAULT_AI_PROMPTS)
    .map(prompt => String(prompt).replace(/\s+/g, " ").trim()).filter(Boolean),
)].slice(0, 12).map(prompt => prompt.slice(0, 400));
const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
export const safeCitationUrl = value => {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    // Never persist provider/API URLs, tokens, or Google redirect payloads.
    if (/^(www\.)?(searchapi\.(io|org)|google\.[a-z.]+)$/.test(url.hostname)) return "";
    url.search = ""; url.hash = "";
    return url.href;
  } catch { return ""; }
};
const isOwnDomain = value => {
  try { return ["thesupremecollective.co.uk", "www.thesupremecollective.co.uk"].includes(new URL(value).hostname); }
  catch { return false; }
};
const prose = blocks => (Array.isArray(blocks) ? blocks : []).flatMap(block => [
  typeof block?.answer === "string" ? block.answer : "",
  typeof block?.text === "string" ? block.text : "",
  ...(Array.isArray(block?.items) ? block.items.flatMap(item => typeof item === "string" ? [item] : [item?.answer, item?.text, ...prose(item?.items)]) : []),
]).filter(Boolean);

export const parseAiObservation = ({ platform, prompt, data, checkedAt = new Date() }) => {
  if (data.error || (data.search_metadata && data.search_metadata.status !== "Success")) {
    throw new Error("Provider did not return a successful search");
  }
  const overview = data.ai_overview;
  const payload = platform === "chatgpt" ? data : overview;
  const base = { platform, prompt, checkedAt };
  if (platform === "google_ai_overview" && !overview && data.search_metadata?.status === "Success") {
    return { ...base, status: "no_overview", mentioned: null, cited: null, citationStatus: "not_applicable", citations: [], excerpt: "" };
  }
  if (payload?.page_token || payload?.response_metadata?.is_truncated || data.response_metadata?.is_truncated) {
    throw new Error("Incomplete AI answer");
  }
  if (platform === "chatgpt" && data.response_metadata?.is_web_search_performed !== true) {
    throw new Error("ChatGPT did not perform the requested web search");
  }
  const text = clean(prose(payload?.text_blocks).join(" ") || payload?.markdown);
  if (!text) throw new Error("AI answer was missing or empty");
  const references = payload.reference_links || payload.references || [];
  const citations = references.map(item => ({ title: clean(item.title).slice(0, 200), url: safeCitationUrl(item.link || item.url) })).filter(item => item.url);
  const unresolved = references.some(item => !safeCitationUrl(item.link || item.url));
  const cited = citations.some(item => isOwnDomain(item.url));
  const mentionIndex = text.search(new RegExp(`\\b(?:supreme\\s+collective|${AI_ARTIST_NAMES.join("|")})\\b`, "i"));
  const excerptStart = Math.max(0, mentionIndex - 100);
  return {
    ...base, status: "observed",
    mentioned: /\b(?:the\s+)?supreme\s+collective\b/i.test(text),
    artistMentions: AI_ARTIST_NAMES.filter(name => new RegExp(`\\b${name}\\b`, "i").test(text)),
    cited: cited ? true : unresolved ? null : false,
    citationStatus: unresolved ? "partially_unresolved" : "resolved",
    citations: citations.slice(0, 30),
    // A short excerpt is evidence only; do not retain whole third-party answers.
    excerpt: text.slice(excerptStart, excerptStart + 500), model: clean(data.response_metadata?.model).slice(0, 100),
  };
};

export const fetchAiObservation = async ({ platform, prompt, request = fetch }) => {
  const query = async (params, postBody) => {
    const url = new URL("https://www.searchapi.io/api/v1/search");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await request(url, {
      headers: { Authorization: `Bearer ${process.env.SEARCHAPI_API_KEY}`, ...(postBody ? { "Content-Type": "application/json" } : {}) },
      ...(postBody ? { method: "POST", body: JSON.stringify({ engine: params.engine, ...postBody }) } : {}),
      signal: AbortSignal.timeout(55000), redirect: "error",
    });
    if (!response.ok) throw new Error(`AI search provider returned HTTP ${response.status}`);
    return response.json();
  };
  let data = await query(platform === "chatgpt"
    ? { engine: "chatgpt", q: prompt, country: "GB", web_search: "true" }
    : { engine: "google", q: prompt, gl: "uk", hl: "en", location: "United Kingdom" });
  if (platform === "google_ai_overview" && data.ai_overview?.page_token) {
    const expanded = await query({ engine: "google_ai_overview", page_token: data.ai_overview.page_token });
    if (expanded.error) throw new Error("AI overview follow-up failed");
    data = { search_metadata: expanded.search_metadata || data.search_metadata, ai_overview: expanded.ai_overview || expanded };
  }
  if (platform === "google_ai_overview" && data.ai_overview) {
    const payload = data.ai_overview;
    const references = payload.reference_links || payload.references || [];
    const pending = references.map((item, index) => ({ item, index }))
      .filter(({ item }) => !safeCitationUrl(item.link || item.url) && typeof item.link_token === "string")
      .slice(0, 25);
    if (pending.length) {
      try {
        // Google now encrypts source destinations. One bounded batch, no retries.
        // The provider documents this resolver as using zero search credits.
        const resolved = await query({ engine: "google_resolve" }, { results: pending.map(({ item, index }) => ({ id: String(index), link_token: item.link_token })) });
        for (const result of resolved.results || []) {
          const index = Number(result.id);
          if (pending.some(item => item.index === index) && !result.error && !result.link_token && safeCitationUrl(result.link)) {
            references[index] = { ...references[index], link: result.link };
          }
        }
        payload.reference_links = references;
      } catch {
        // Keep unresolved citations unknown; a resolver failure must not erase a valid answer.
      }
    }
  }
  return parseAiObservation({ platform, prompt, data });
};

export const summariseAiVisibility = (samples = []) => AI_PLATFORMS.map(platform => {
  const rows = samples.filter(row => row.platform === platform);
  const observed = rows.filter(row => row.status === "observed");
  const resolved = observed.filter(row => row.cited != null);
  return { platform, attempted: rows.length, observed: observed.length,
    mentions: observed.filter(row => row.mentioned).length,
    citations: resolved.filter(row => row.cited).length, citationChecks: resolved.length,
    noOverview: rows.filter(row => row.status === "no_overview").length,
    unavailable: rows.filter(row => row.status === "unavailable").length };
});

export const getAiVisibility = async ({ tracker, periods, collect = false }) => {
  const prompts = normaliseAiPrompts(tracker.aiPrompts);
  const watchlistHash = crypto.createHash("sha256").update(JSON.stringify({ prompts, platforms: AI_PLATFORMS, country: "GB", language: "en", version: 2 })).digest("hex");
  const identity = { propertyUrl: tracker.propertyUrl, reportPeriodStart: periods.periodStart, watchlistHash };
  let record = await SeoAiSnapshot.findOne(identity).lean();
  if (!record && collect && tracker.aiEnabled !== false && aiVisibilityConfigured() && prompts.length) {
    try { record = await SeoAiSnapshot.create(identity); }
    catch (error) {
      if (error.code !== 11000) throw error;
      record = await SeoAiSnapshot.findOne(identity).lean();
      return { status: "collecting", summary: [], samples: [] };
    }
    const samples = [];
    // At most 12 prompts x 2 platforms, plus one Google follow-up per prompt.
    // No automatic retries: report failures without repeatedly buying requests.
    for (const prompt of prompts) {
      samples.push(...await Promise.all(AI_PLATFORMS.map(async platform => {
        try { return await fetchAiObservation({ platform, prompt }); }
        catch { return { platform, prompt, checkedAt: new Date(), status: "unavailable", mentioned: null, cited: null, citations: [], error: "AI check unavailable; no result inferred" }; }
      })));
    }
    record = await SeoAiSnapshot.findOneAndUpdate(identity,
      { $set: { samples, status: "complete", completedAt: new Date() } }, { new: true }).lean();
  }
  if (!record) return { status: tracker.aiEnabled === false ? "disabled" : !aiVisibilityConfigured() ? "not_configured" : "not_sampled", summary: [], samples: [] };
  const previous = await SeoAiSnapshot.findOne({ propertyUrl: tracker.propertyUrl, reportPeriodStart: periods.comparisonStart, watchlistHash, status: "complete" }).lean();
  const summary = summariseAiVisibility(record.samples).map(row => {
    const coverage = samples => samples.filter(sample => sample.platform === row.platform)
      .map(sample => [sample.prompt, sample.status, sample.cited == null, sample.model || ""]).sort((a, b) => a[0].localeCompare(b[0]));
    return { ...row, comparable: Boolean(previous) && row.observed > 0 && row.unavailable === 0 &&
      JSON.stringify(coverage(record.samples)) === JSON.stringify(coverage(previous.samples)) };
  });
  return { status: record.status, provider: "searchapi", country: "GB", language: "en",
    checkedAt: record.completedAt, watchlistHash,
    samples: record.samples, summary,
    previousSummary: previous ? summariseAiVisibility(previous.samples) : null,
    comparisonAvailable: Boolean(previous),
  };
};
