import test from "node:test";
import assert from "node:assert/strict";

import { automationBodyToHtml } from "../utils/automationEmailTemplate.js";

test("automation email templates support labelled links", () => {
  const html = automationBodyToHtml(
    "[Follow This Link to your Event Sheet](https://thesupremecollective.co.uk/event-sheet/BBM%20497%20DESIGN)",
  );

  assert.match(html, />Follow This Link to your Event Sheet<\/a>/);
  assert.match(html, /href="https:\/\/thesupremecollective\.co\.uk\/event-sheet\/BBM%20497%20DESIGN"/);
  assert.doesNotMatch(html, /\]\(<a/);
});

test("automation email templates escape unsafe labels", () => {
  const html = automationBodyToHtml("[<script>alert(1)</script>](https://example.com)");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
