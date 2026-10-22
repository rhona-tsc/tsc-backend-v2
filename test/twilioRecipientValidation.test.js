import assert from "node:assert/strict";
import test from "node:test";

test("Twilio recipient normalisation accepts valid UK formats", async () => {
  const { toE164 } = await import("../utils/twilioClient.js");

  assert.equal(toE164("07700 900123"), "+447700900123");
  assert.equal(toE164("44 7700 900123"), "+447700900123");
  assert.equal(toE164("whatsapp:+447700900123"), "+447700900123");
  assert.equal(toE164("00447700900123"), "+447700900123");
});

test("Twilio recipient normalisation rejects malformed application values", async () => {
  const { toE164 } = await import("../utils/twilioClient.js");

  assert.equal(toE164("+44undefined"), "");
  assert.equal(toE164("[object Object]"), "");
  assert.equal(toE164({ phone: "+447700900123" }), "");
  assert.equal(toE164(""), "");
});
