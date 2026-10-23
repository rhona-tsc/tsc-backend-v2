import test from "node:test";
import assert from "node:assert/strict";
import { postcodes } from "../utils/postcodes.js";

test("maps the BD23 postcode district to North Yorkshire only", () => {
  const table = Array.isArray(postcodes) ? postcodes[0] || {} : postcodes || {};
  const matchingCounties = Object.entries(table)
    .filter(([, outcodes]) => Array.isArray(outcodes) && outcodes.includes("BD23"))
    .map(([county]) => county);

  assert.deepEqual(matchingCounties, ["north_yorkshire"]);
});
