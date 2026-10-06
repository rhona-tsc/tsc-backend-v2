import test from "node:test";
import assert from "node:assert/strict";
import { buildAnonymousYoutubeMetadata } from "../services/youtubeVideoService.js";

test("YouTube metadata uses first name and surname initial only", () => {
  const metadata = buildAnonymousYoutubeMetadata({
    musician: { firstName: "Sarah", lastName: "Lucken" },
    submission: { category: "function" },
  });
  assert.match(metadata.title, /^Sarah L \|/);
  assert.doesNotMatch(`${metadata.title} ${metadata.description}`, /Lucken/i);
  assert.equal(metadata.tags.includes("function musician"), true);
});
