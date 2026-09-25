import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptSocialToken,
  encryptSocialToken,
} from "../utils/socialTokenCrypto.js";

test("social OAuth tokens are encrypted at rest and decrypt correctly", () => {
  const previous = process.env.SOCIAL_OAUTH_ENCRYPTION_KEY;
  process.env.SOCIAL_OAUTH_ENCRYPTION_KEY = "test-only-social-oauth-key";
  try {
    const plain = "provider-access-token";
    const encrypted = encryptSocialToken(plain);
    assert.notEqual(encrypted, plain);
    assert.equal(decryptSocialToken(encrypted), plain);
  } finally {
    if (previous === undefined) delete process.env.SOCIAL_OAUTH_ENCRYPTION_KEY;
    else process.env.SOCIAL_OAUTH_ENCRYPTION_KEY = previous;
  }
});
