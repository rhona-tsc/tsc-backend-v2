import test from "node:test";
import assert from "node:assert/strict";
import { classifyVideoUrl, extractModerationFlags } from "../services/videoModerationService.js";

test("classifies supported and manual-review video links", () => {
  assert.equal(classifyVideoUrl("https://youtu.be/abc123").provider, "youtube");
  assert.equal(classifyVideoUrl("https://youtu.be/abc123").automationEligible, false);
  assert.equal(classifyVideoUrl("https://cdn.example.com/showreel.mp4").automationEligible, true);
  assert.equal(classifyVideoUrl("https://drive.google.com/drive/folders/folder123").accessStatus, "folder_link");
  const drive = classifyVideoUrl("https://drive.google.com/file/d/file123/view");
  assert.equal(drive.provider, "google_drive");
  assert.match(drive.resolvedMediaUrl, /file123/);
});

test("extracts contact and identity indicators from Azure insights", () => {
  const flags = extractModerationFlags({
    videos: [{ insights: {
      transcript: [{ text: "Book us at band@example.com or call 07123 456 789 @bestband" }],
      ocr: [{ text: "www.bestband.test" }],
      namedPeople: [{ name: "Alex Example" }],
      brands: [{ name: "The Best Band" }],
    } }],
  });
  const types = new Set(flags.map((flag) => flag.type));
  for (const type of ["email", "phone", "website", "social_handle", "person_name", "brand_name"]) assert.ok(types.has(type), `missing ${type}`);
});
