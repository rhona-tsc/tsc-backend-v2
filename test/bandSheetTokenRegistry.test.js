import assert from "node:assert/strict";
import test from "node:test";
import {
  bandSheetTokenLookup,
  bandSheetTokenPersistenceUpdate,
} from "../utils/bandSheetTokenRegistry.js";

test("band-sheet links resolve against the active token and permanent registry", () => {
  assert.deepEqual(bandSheetTokenLookup(" old-link "), {
    $or: [
      { "eventSheet.bandSheetToken": "old-link" },
      { bandSheetTokens: "old-link" },
    ],
  });
});

test("issuing a token updates the active token and permanent registry together", () => {
  assert.deepEqual(bandSheetTokenPersistenceUpdate(" new-link "), {
    $set: { "eventSheet.bandSheetToken": "new-link" },
    $addToSet: { bandSheetTokens: "new-link" },
  });
  assert.equal(bandSheetTokenPersistenceUpdate("  "), null);
});
