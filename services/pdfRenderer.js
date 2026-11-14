import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import { logMemory } from "../utils/memoryMonitor.js";

const timed = async (operation, milliseconds, message) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
};

// All contract routes share this renderer so Chromium processes cannot overlap.
// Bound the queue as well: queued HTML and request objects also consume memory.
export function createPdfRenderer({ launch, maxWaiting = 4, waitMs = 60000, renderMs = 60000, closeMs = 5000, logger = console, sampleMemory = logMemory } = {}) {
  let active = false;
  let cleanupFailed = false;
  const waiting = [];

  function acquire() {
    if (cleanupFailed) return Promise.reject(new Error("PDF renderer unavailable after cleanup failure"));
    if (!active) { active = true; return Promise.resolve(); }
    if (waiting.length >= maxWaiting) return Promise.reject(new Error("PDF queue is full; please try again shortly"));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(new Error("PDF queue wait timed out; please try again shortly"));
      }, waitMs);
      waiting.push(entry);
    });
  }

  function release() {
    if (cleanupFailed) {
      for (const entry of waiting.splice(0)) {
        clearTimeout(entry.timer);
        entry.reject(new Error("PDF renderer unavailable after cleanup failure"));
      }
      active = false;
      return;
    }
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
    else active = false;
  }

  async function close(browser) {
    const child = browser.process?.();
    try {
      await timed(Promise.resolve().then(() => browser.close()), closeMs, "PDF browser close timed out");
    } catch {
      // Do not log HTML, recipient information or browser error details.
      logger.warn("[pdf] browser cleanup required forced termination");
      if (!child || child.exitCode != null || child.signalCode != null) {
        if (!child) throw new Error("PDF browser cleanup failed");
        return;
      }
      child.kill("SIGKILL");
      await timed(new Promise((resolve) => {
        child.once("exit", resolve);
        if (child.exitCode != null || child.signalCode != null) resolve();
      }), closeMs, "PDF browser process did not exit");
    }
  }

  return async function renderPdf(html, { waitUntil = "load", ...pdfOptions } = {}) {
    await acquire();
    let browser;
    try {
      logger.info("[pdf] render started", { queued: waiting.length });
      await sampleMemory("pdf-start", logger).catch(() => {});
      // Launchers must have their own timeout; a late launch must not escape cleanup.
      browser = await launch();
      const output = await timed((async () => {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(30000);
        await page.setContent(html, { waitUntil, timeout: 30000 });
        return await page.pdf({ format: "A4", ...pdfOptions, timeout: 30000 });
      })(), renderMs, "PDF rendering timed out");
      return Buffer.from(output);
    } finally {
      try {
        if (browser) {
          try { await close(browser); }
          catch (error) { cleanupFailed = true; throw error; }
        }
      } finally {
        await sampleMemory("pdf-end", logger).catch(() => {});
        logger.info("[pdf] render finished", { queued: waiting.length });
        release();
      }
    }
  };
}

export async function launchPdfBrowser() {
  if (process.platform !== "linux") return puppeteer.launch({ headless: true, timeout: 30000 });
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    timeout: 30000,
  });
}

export const renderPdf = createPdfRenderer({ launch: launchPdfBrowser });
