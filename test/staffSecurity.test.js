import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { readFile } from "node:fs/promises";
import requireStaffAuth from "../middleware/requireStaffAuth.js";
import requireAnyAuth from "../middleware/requireAnyAuth.js";
import documentUpload, { DOCUMENT_UPLOAD_LIMIT } from "../middleware/documentUpload.js";

test("finance rejects anonymous, forged, expired and non-staff sessions", async t => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "security-test-only-secret";
  const app = express();
  app.use("/api/finance", requireStaffAuth);
  app.get("/api/finance/accounts", (_req, res) => res.json({ success: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.close(); if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const url = `http://127.0.0.1:${server.address().port}/api/finance/accounts`;
  const sign = (claims, opts = {}) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "1h", ...opts });
  for (const [token, status] of [
    ["", 401], ["forged", 401],
    [sign({ role: "agent", email: "hello@thesupremecollective.co.uk" }, { expiresIn: -1 }), 401],
    [sign({ id: "client" }), 403],
    [sign({ role: "musician", email: "hello@thesupremecollective.co.uk" }), 403],
    [sign({ role: "agent", email: "outsider@example.com" }), 403],
    [sign({ role: "agent", email: "hello@thesupremecollective.co.uk" }), 200],
  ]) {
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
  const legacy = await fetch(url, { headers: { token: sign({ role: "agent", email: "hello@thesupremecollective.co.uk" }) } });
  assert.equal(legacy.status, 200);
});

test("uploads require authentication before parsing, limit size and restrict types", async t => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "security-upload-test-only-secret";
  const app = express();
  app.post("/doc", requireAnyAuth, documentUpload, (req, res) => res.json({ bytes: req.file?.size }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.close(); if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const url = `http://127.0.0.1:${server.address().port}/doc`;
  const token = jwt.sign({ id: "client" }, process.env.JWT_SECRET);
  const send = async (data, name, type, authenticated = true) => {
    const form = new FormData(); form.append("file", new Blob([data], { type }), name);
    const response = await fetch(url, { method: "POST", body: form, headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });
    await response.arrayBuffer(); return response.status;
  };
  assert.equal(await send("test", "test.pdf", "application/pdf", false), 401);
  assert.equal(await send("test", "test.pdf", "application/pdf"), 200);
  assert.equal(await send("test", "script.html", "text/html"), 415);
  assert.equal(await send("test", "script.pdf", "text/html"), 415);
  assert.equal(await send(new Uint8Array(DOCUMENT_UPLOAD_LIMIT + 1), "large.pdf", "application/pdf"), 413);
});

test("all finance, admin and debug prefixes are guarded before handlers", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  for (const prefix of ["/api/finance", "/api/admin", "/api/debug", "/debug"]) {
    assert.ok(source.includes(`app.use("${prefix}", requireStaffAuth)`));
  }
  assert.ok(source.indexOf('app.use("/api/finance", requireStaffAuth)') < source.indexOf('app.use("/api/finance/bookings",'));
  assert.ok(source.indexOf('app.use("/api/admin", requireStaffAuth)') < source.indexOf('app.post("/api/admin/'));
});

test("Google OAuth and refresh handlers do not log credential values", async () => {
  const google = await readFile(new URL("../controllers/googleController.js", import.meta.url), "utf8");
  assert.doesNotMatch(google, /console\.log\([^\n]*(?:tokens\.refresh_token|['"]🔐 Tokens|mask\(rtok)/);
  const auth = await readFile(new URL("../routes/authRoutes.js", import.meta.url), "utf8");
  assert.doesNotMatch(auth, /console\.log\([^\n]*, refreshToken\)/);
});
