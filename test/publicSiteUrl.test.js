import test from "node:test";
import assert from "node:assert/strict";
import { buildEventSheetUrl, getPublicSiteBaseUrl } from "../utils/publicSiteUrl.js";

const ENV_KEYS = ["PUBLIC_SITE_URL", "PUBLIC_FRONTEND_URL", "FRONTEND_URL", "CLIENT_URL", "FRONTEND_BASE_URL"];

const withEnv = (values, callback) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { callback(); } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test("customer event-sheet links never fall back to localhost", () => {
  withEnv({ FRONTEND_BASE_URL: "http://localhost:5174" }, () => {
    assert.equal(getPublicSiteBaseUrl(), "https://thesupremecollective.co.uk");
    assert.equal(buildEventSheetUrl("261128-MEISSNER-66844"), "https://thesupremecollective.co.uk/event-sheet/261128-MEISSNER-66844");
  });
});

test("a configured non-local public site URL is honoured", () => {
  withEnv({ PUBLIC_SITE_URL: "https://www.thesupremecollective.co.uk/" }, () => {
    assert.equal(buildEventSheetUrl("ABC 123"), "https://www.thesupremecollective.co.uk/event-sheet/ABC%20123");
  });
});
