import test from "node:test";
import assert from "node:assert/strict";
import SeoAiSnapshot from "../models/seoAiSnapshotModel.js";
import { fetchAiObservation, getAiVisibility, normaliseAiPrompts, parseAiObservation, safeCitationUrl, summariseAiVisibility } from "../services/seoAiVisibilityService.js";
import { renderAiVisibilityEmail } from "../services/seoVisibilityEmail.js";

const success = { search_metadata: { status: "Success" } };
const chat = { ...success, markdown: "The Supreme Collective offers wedding bands.", response_metadata: { is_web_search_performed: true, model: "provider-model" }, reference_links: [{ title: "Wedding bands", link: "https://thesupremecollective.co.uk/wedding-bands-surrey/?utm_source=chatgpt" }] };
const prompt = "Which wedding bands can I hire in Surrey?";

test("real ChatGPT search answers distinguish prose mentions from citations and retrieved results", () => {
  const row = parseAiObservation({ platform: "chatgpt", prompt, data: chat });
  assert.equal(row.mentioned, true); assert.equal(row.cited, true);
  assert.equal(row.citations[0].url, "https://thesupremecollective.co.uk/wedding-bands-surrey/");
  const notMentioned = parseAiObservation({ platform: "chatgpt", prompt, data: { ...chat, markdown: "Other wedding bands are available.", reference_links: [], web_results: chat.reference_links } });
  assert.equal(notMentioned.mentioned, false); assert.equal(notMentioned.cited, false);
});
test("empty, truncated, failed and non-search answers cannot become false zeroes", () => {
  for (const data of [{ ...chat, error: "private provider error" }, { ...chat, markdown: "" }, { ...chat, response_metadata: { is_truncated: true } }, { ...chat, response_metadata: { is_web_search_performed: false } }]) {
    assert.throws(() => parseAiObservation({ platform: "chatgpt", prompt, data }));
  }
  const noOverview = parseAiObservation({ platform: "google_ai_overview", prompt, data: { ...success, organic_results: chat.reference_links } });
  assert.equal(noOverview.status, "no_overview"); assert.equal(noOverview.mentioned, null);
  assert.throws(() => parseAiObservation({ platform: "google_ai_overview", prompt, data: {} }));
});
test("unresolved Google citations are unknown rather than incorrectly absent", () => {
  const row = parseAiObservation({ platform: "google_ai_overview", prompt, data: { ...success, ai_overview: { text_blocks: [{ type: "paragraph", answer: "Wedding entertainment options." }], reference_links: [{ link: "https://www.google.com/goto?url=encrypted", link_token: "private-token" }] } } });
  assert.equal(row.cited, null); assert.equal(row.citationStatus, "partially_unresolved");
  assert.equal(safeCitationUrl("javascript:alert(1)"), "");
  assert.equal(safeCitationUrl("https://user:secret@example.com"), "");
  assert.equal(safeCitationUrl("https://www.searchapi.io/api/v1/search?api_key=secret"), "");
  assert.equal(safeCitationUrl("https://thesupremecollective.co.uk.evil.example/"), "https://thesupremecollective.co.uk.evil.example/");
  const impostor = parseAiObservation({ platform: "chatgpt", prompt, data: { ...chat, reference_links: [{ link: "https://thesupremecollective.co.uk.evil.example/" }] } });
  assert.equal(impostor.cited, false);
});
test("Google's token follow-up stays on the fixed provider endpoint and preserves the overview", async () => {
  const calls = [];
  const row = await fetchAiObservation({ platform: "google_ai_overview", prompt, request: async (url, options) => {
    calls.push(url);
    assert.equal(url.origin, "https://www.searchapi.io"); assert.equal(options.redirect, "error");
    assert.equal(url.searchParams.has("api_key"), false);
    return new Response(JSON.stringify(calls.length === 1 ? { ...success, ai_overview: { page_token: "synthetic-token", serpapi_link: "https://evil.example" } } : { text_blocks: [{ answer: "The Supreme Collective" }], reference_links: chat.reference_links }));
  } });
  assert.equal(calls.length, 2); assert.equal(calls[0].searchParams.get("gl"), "uk");
  assert.equal(calls[1].searchParams.get("engine"), "google_ai_overview");
  assert.equal(row.mentioned, true); assert.equal(row.cited, true);
});
test("sample denominators exclude unavailable checks and missing overviews", () => {
  const summary = summariseAiVisibility([
    { platform: "google_ai_overview", status: "observed", mentioned: true, cited: true },
    { platform: "google_ai_overview", status: "observed", mentioned: false, cited: null },
    { platform: "google_ai_overview", status: "no_overview" },
    { platform: "google_ai_overview", status: "unavailable" },
  ])[1];
  assert.deepEqual(summary, { platform: "google_ai_overview", attempted: 4, observed: 2, mentions: 1, citations: 1, citationChecks: 1, noOverview: 1, unavailable: 1 });
  assert.equal(normaliseAiPrompts(Array(20).fill(" a ").concat(Array.from({ length: 20 }, (_, i) => String(i)))).length, 12);
});
test("Google encrypted citations resolve in one bounded authenticated POST without forwarding arbitrary URLs", async () => {
  const calls = [];
  const row = await fetchAiObservation({ platform: "google_ai_overview", prompt, request: async (url, options) => {
    calls.push(url.searchParams.get("engine"));
    if (calls.length === 1) return new Response(JSON.stringify({ ...success, ai_overview: { markdown: "The Supreme Collective offers wedding bands.", reference_links: [{ title: "Wedding bands", link: "https://www.google.com/goto?url=encrypted", link_token: "synthetic-token" }] } }));
    assert.equal(url.origin, "https://www.searchapi.io"); assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { engine: "google_resolve", results: [{ id: "0", link_token: "synthetic-token" }] });
    return new Response(JSON.stringify({ results: [{ id: "0", link: "https://thesupremecollective.co.uk/wedding-bands-surrey/" }] }));
  } });
  assert.deepEqual(calls, ["google", "google_resolve"]);
  assert.equal(row.cited, true); assert.equal(row.citationStatus, "resolved");
});
test("a failed resolver preserves the valid answer and unknown citation state", async () => {
  let calls = 0;
  const row = await fetchAiObservation({ platform: "google_ai_overview", prompt, request: async () => {
    if (calls++) return new Response("Provider unavailable", { status: 503 });
    return new Response(JSON.stringify({ ...success, ai_overview: { markdown: "Wedding bands offer live music.", reference_links: [{ link: "https://www.google.com/goto?url=encrypted", link_token: "synthetic-token" }] } }));
  } });
  assert.equal(calls, 2); assert.equal(row.status, "observed"); assert.equal(row.cited, null);
});
test("refresh reuses the monthly sample without network access or new purchases", async t => {
  const sample = { platform: "chatgpt", prompt, status: "observed", mentioned: true, cited: true, citations: [], model: "fixed" };
  const queries = [];
  t.mock.method(SeoAiSnapshot, "findOne", query => {
    queries.push(query);
    return { lean: async () => ({ status: "complete", samples: [sample], completedAt: new Date("2026-11-04") }) };
  });
  t.mock.method(globalThis, "fetch", () => { throw new Error("Must not make a paid request"); });
  const result = await getAiVisibility({ tracker: { propertyUrl: "test", aiPrompts: [prompt] }, periods: { periodStart: "2026-10-01", comparisonStart: "2026-09-01" }, collect: true });
  assert.equal(result.summary[0].comparable, true);
  assert.equal(queries[0].watchlistHash, queries[1].watchlistHash);
});
test("changed coverage is not reported as month-on-month progress", async t => {
  let count = 0;
  t.mock.method(SeoAiSnapshot, "findOne", () => ({ lean: async () => ({ status: "complete", samples: [{ platform: "chatgpt", prompt, status: "observed", mentioned: true, cited: true, model: count++ ? "old-model" : "new-model" }] }) }));
  const result = await getAiVisibility({ tracker: { propertyUrl: "test", aiPrompts: [prompt] }, periods: { periodStart: "2026-10-01", comparisonStart: "2026-09-01" } });
  assert.equal(result.summary[0].comparable, false);
});
test("digest keeps missing data explicit, escapes evidence and rejects unsafe links", () => {
  assert.match(renderAiVisibilityEmail({ status: "not_configured" }), /No AI checks have run/);
  const html = renderAiVisibilityEmail({ status: "complete", checkedAt: "2026-11-04", summary: [], samples: [{ platform: "chatgpt", prompt: "<img src=x onerror=alert(1)>", status: "observed", mentioned: true, cited: false, citations: [{ title: "bad", url: "javascript:alert(1)" }] }] });
  assert.doesNotMatch(html, /<img|href="javascript:/); assert.match(html, /&lt;img/);
  assert.match(html, /not an average/); assert.match(html, /not universal rankings/);
});
