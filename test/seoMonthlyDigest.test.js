import test from "node:test";
import assert from "node:assert/strict";
import SeoKeywordTracker from "../models/seoKeywordTrackerModel.js";
import SeoKeywordSnapshot from "../models/seoKeywordSnapshotModel.js";
import SeoAiSnapshot from "../models/seoAiSnapshotModel.js";
import { google } from "googleapis";
import { buildSeoDigestEmail, buildSeoSnapshot, completedMonthPeriods, runSeoMonthlyReport } from "../services/seoKeywordService.js";

test("monthly digest uses the last completed calendar month, including year boundaries", () => {
  assert.deepEqual(completedMonthPeriods(new Date("2027-01-04T12:00:00Z")), { periodStart: "2026-12-01", periodEnd: "2026-12-31", comparisonStart: "2026-11-01", comparisonEnd: "2026-11-30" });
});
test("one digest includes organic results and explicit unconnected AI state without inventing rankings", () => {
  const result = buildSeoDigestEmail({ periodStart: "2026-10-01", periodEnd: "2026-10-31", comparisonStart: "2026-09-01", comparisonEnd: "2026-09-30", rows: [{ keyword: "funk wedding band", clicks: 0, impressions: 1, position: 64, positionChange: null, status: "Needs optimisation" }], aiVisibility: { status: "not_configured" } });
  assert.match(result.subject, /SEO & AI visibility/);
  assert.match(result.html, /Google organic search/); assert.match(result.html, /AI search visibility/);
  assert.match(result.html, /No AI checks have run/); assert.match(result.html, /not Google Ads/);
});
test("overlapping monthly runs stop before collecting or sending another report", async t => {
  t.mock.method(SeoKeywordTracker, "findOne", async () => ({ _id: "synthetic-tracker" }));
  t.mock.method(SeoKeywordTracker, "updateOne", async () => ({ modifiedCount: 0 }));
  t.mock.method(SeoKeywordSnapshot, "findOne", () => { throw new Error("Must not query or send a duplicate report"); });
  await assert.rejects(runSeoMonthlyReport({ skipIfEmailed: true }), /already running/);
});
test("an already emailed monthly digest is reused and the processing lease is released", async t => {
  const updates = [];
  t.mock.method(SeoKeywordTracker, "findOne", async () => ({ _id: "synthetic-tracker", propertyUrl: "test-property" }));
  t.mock.method(SeoKeywordTracker, "updateOne", async (query, update) => { updates.push({ query, update }); return { modifiedCount: 1 }; });
  const existing = { emailedAt: new Date(), periodStart: "2026-10-01" };
  t.mock.method(SeoKeywordSnapshot, "findOne", async () => existing);
  t.mock.method(globalThis, "fetch", () => { throw new Error("No external requests allowed"); });
  assert.equal(await runSeoMonthlyReport({ skipIfEmailed: true }), existing);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].query.monthlyReportLeaseOwner, updates[0].update.$set.monthlyReportLeaseOwner);
  assert.ok(updates[1].update.$unset.monthlyReportLeaseUntil !== undefined);
});
test("organic results survive AI storage failure and retain weighted positions and null missing rankings", async t => {
  const previous = process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS;
  process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS = "{}";
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS; else process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS = previous; });
  t.mock.method(google.auth.GoogleAuth.prototype, "getClient", async () => ({}));
  let calls = 0;
  t.mock.method(google, "searchconsole", () => ({ searchanalytics: { query: async ({ requestBody }) => {
    assert.equal(requestBody.type, "web");
    calls++;
    return { data: { rows: calls === 1 ? [
      { keys: ["funk wedding band", "https://example.test/a"], clicks: 4, impressions: 100, position: 3 },
      { keys: ["funk wedding band", "https://example.test/b"], clicks: 2, impressions: 20, position: 1 },
    ] : [] } };
  } } }));
  t.mock.method(SeoAiSnapshot, "findOne", () => ({ lean: async () => { throw new Error("Synthetic AI storage outage"); } }));
  t.mock.method(SeoKeywordSnapshot, "findOneAndUpdate", async (_filter, update) => update);
  const result = await buildSeoSnapshot({ tracker: { propertyUrl: "test", keywords: [{ term: "funk wedding band" }, { term: "unobserved phrase" }] } });
  assert.equal(result.rows[0].clicks, 6); assert.equal(result.rows[0].impressions, 120);
  assert.equal(result.rows[0].position, 320 / 120); assert.equal(result.rows[0].ctr, 6 / 120);
  assert.equal(result.rows[1].position, null); assert.equal(result.aiVisibility.status, "unavailable");
});
