import assert from "node:assert/strict";
import test from "node:test";

import { validateDeputyCanonicalIdentity } from "../utils/deputyIdentity.js";

test("accepts the same musician id", () => {
  const result = validateDeputyCanonicalIdentity(
    { musicianId: "abc", firstName: "Stored alias" },
    { _id: "abc", firstName: "Canonical name" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.matchedBy, "musician_id");
});

test("accepts a duplicate profile when the person name still matches", () => {
  const result = validateDeputyCanonicalIdentity(
    { musicianId: "old-id", firstName: "Shamyra" },
    { _id: "new-id", firstName: "Shamyra" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.matchedBy, "first_name");
});

test("blocks a Shamyra deputy record whose phone resolves to Ewan", () => {
  const result = validateDeputyCanonicalIdentity(
    {
      musicianId: "stale-shamyra-id",
      firstName: "Shamyra",
      email: "tscbigband@gmail.com",
    },
    {
      _id: "ewan-id",
      firstName: "Ewan",
      email: "ewan@example.com",
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "deputy_phone_resolves_to_different_musician");
});

