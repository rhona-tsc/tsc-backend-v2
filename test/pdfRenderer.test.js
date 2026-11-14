import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import puppeteer from "puppeteer";
import { createPdfRenderer } from "../services/pdfRenderer.js";
import { logMemory, startMemoryMonitor } from "../utils/memoryMonitor.js";

const quiet = { info() {}, warn() {} };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  let closes = 0;
  const page = { setDefaultNavigationTimeout() {}, async setContent() {}, async pdf() { return new Uint8Array([37, 80, 68, 70]); }, ...overrides.page };
  const browser = { async newPage() { return page; }, async close() { closes++; }, ...overrides.browser };
  return { browser, get closes() { return closes; } };
}
const renderer = (launch, options = {}) => createPdfRenderer({ launch, logger: quiet, sampleMemory: async () => {}, ...options });

test("returns a Buffer and closes the browser after successful PDF creation", async () => {
  const f = fixture();
  const output = await renderer(async () => f.browser)("synthetic");
  assert.ok(Buffer.isBuffer(output));
  assert.equal(output.toString(), "%PDF");
  assert.equal(f.closes, 1);
});

for (const stage of ["newPage", "setContent", "pdf"]) {
  test(`closes the browser when ${stage} fails and allows the next job`, async () => {
    const failure = async () => { throw new Error("synthetic failure"); };
    const f = fixture(stage === "newPage" ? { browser: { newPage: failure } } : { page: { [stage]: failure } });
    const next = fixture();
    let launches = 0;
    const render = renderer(async () => ++launches === 1 ? f.browser : next.browser);
    await assert.rejects(render("synthetic"), /synthetic failure/);
    assert.equal(f.closes, 1);
    await render("next");
    assert.equal(next.closes, 1);
  });
}

test("a failed launch releases the slot", async () => {
  const f = fixture(); let calls = 0;
  const render = renderer(async () => { if (++calls === 1) throw new Error("launch failed"); return f.browser; });
  await assert.rejects(render("one"), /launch failed/);
  await render("two");
  assert.equal(f.closes, 1);
});

test("serializes browser lifetime including cleanup and bounds waiting jobs", async () => {
  const rendering = deferred(); const closing = deferred(); const startedClose = deferred();
  const f = fixture({ page: { pdf: () => rendering.promise }, browser: { close: async () => { startedClose.resolve(); await closing.promise; } } });
  const next = fixture(); let launches = 0;
  const render = renderer(async () => ++launches === 1 ? f.browser : next.browser, { maxWaiting: 1 });
  const one = render("one"); const two = render("two");
  await assert.rejects(render("three"), /queue is full/);
  assert.equal(launches, 1);
  rendering.resolve(new Uint8Array([1]));
  await startedClose.promise;
  assert.equal(launches, 1, "second browser must not launch while first is closing");
  closing.resolve();
  await Promise.all([one, two]);
  assert.equal(launches, 2);
});

test("an expired queue entry never launches later", async () => {
  const hold = deferred(); const f = fixture({ page: { pdf: () => hold.promise } }); let launches = 0;
  const render = renderer(async () => { launches++; return f.browser; }, { waitMs: 10 });
  const first = render("one");
  await assert.rejects(render("two"), /queue wait timed out/);
  hold.resolve(new Uint8Array([1])); await first;
  await render("three");
  assert.equal(launches, 2);
});

test("a stuck render times out and still closes its browser", async () => {
  const f = fixture({ page: { pdf: () => new Promise(() => {}) } });
  await assert.rejects(renderer(async () => f.browser, { renderMs: 10 })("synthetic"), /rendering timed out/);
  assert.equal(f.closes, 1);
});

test("a stuck close kills the child before allowing the next browser", async () => {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  let kills = 0;
  child.kill = signal => { kills++; child.signalCode = signal; child.emit("exit"); };
  const f = fixture({ browser: { close: () => new Promise(() => {}), process: () => child } });
  const next = fixture(); let launches = 0;
  const render = renderer(async () => ++launches === 1 ? f.browser : next.browser, { closeMs: 10 });
  await Promise.all([render("one"), render("two")]);
  assert.equal(kills, 1);
  assert.equal(launches, 2);
});

test("unrecoverable cleanup rejects queued and future work rather than spawning more browsers", async () => {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.kill = () => { throw new Error("kill failed"); };
  const f = fixture({ browser: { async close() { throw new Error("close failed"); }, process: () => child } });
  const render = renderer(async () => f.browser);
  const outcomes = await Promise.allSettled([render("one"), render("two")]);
  assert.ok(outcomes.every(result => result.status === "rejected"));
  await assert.rejects(render("three"), /unavailable after cleanup failure/);
});

test("memory logging records numbers without request or customer information", async () => {
  const logs = [];
  await logMemory("test", { info: (...args) => logs.push(args) });
  assert.equal(logs[0][0], "[memory]");
  assert.ok(logs[0][1].rssMiB > 0);
  assert.deepEqual(Object.keys(logs[0][1]).filter(key => !/^(reason|rssMiB|heapUsedMiB|heapTotalMiB|externalMiB|arrayBuffersMiB|containerMiB|containerLimitMiB|uptimeSeconds)$/.test(key)), []);
  const stop = startMemoryMonitor({ logger: quiet }); stop();
});

test("shared renderer creates a real synthetic PDF and closes Chrome", { timeout: 45000 }, async () => {
  let browser;
  const render = renderer(async () => { browser = await puppeteer.launch({ headless: true, timeout: 30000 }); return browser; });
  const pdf = await render("<!doctype html><html><body><h1>Synthetic contract</h1><p>Memory safety check only.</p></body></html>", { printBackground: true });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1000);
  assert.equal(browser.connected, false);
});
