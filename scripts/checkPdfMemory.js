// Synthetic deployment check: no database access, emails, bookings or external assets.
import { renderPdf } from "../services/pdfRenderer.js";
import { logMemory } from "../utils/memoryMonitor.js";
import assert from "node:assert/strict";

await logMemory("pdf-smoke-before");
for (let index = 0; index < 2; index++) {
  const pdf = await renderPdf("<!doctype html><html><body><h1>Synthetic contract</h1><p>Deployment memory check only.</p></body></html>", { printBackground: true });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1000);
}
await logMemory("pdf-smoke-after");
console.log("[pdf-smoke] OK: two synthetic PDFs generated and browsers closed");
