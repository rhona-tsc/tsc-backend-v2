import test from "node:test";
import assert from "node:assert/strict";

import {
  inviteTokenCanBeUsed,
  NON_EXPIRING_INVITE_TOKEN_DATE,
} from "../utils/musicianInviteToken.js";

test("musician invitation links remain valid regardless of a legacy expiry date", () => {
  assert.equal(inviteTokenCanBeUsed({
    inviteTokenHash: "hashed-token",
    inviteTokenExpires: new Date("2020-01-01T00:00:00.000Z"),
  }), true);
});

test("used or revoked musician invitation links remain invalid", () => {
  assert.equal(inviteTokenCanBeUsed({ inviteTokenHash: null }), false);
});

test("new musician invitations are stored without an expiry date", () => {
  assert.equal(NON_EXPIRING_INVITE_TOKEN_DATE, null);
});
