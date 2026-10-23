import test from "node:test";
import assert from "node:assert/strict";
import { finalDetailsDueISO } from "../utils/finalDetailsDueDate.js";

test("uses Thursday in the week before a Saturday booking", () => {
  assert.equal(
    finalDetailsDueISO({ eventDateISO: "2026-11-21", bookingDateISO: "2026-09-27" }),
    "2026-11-12",
  );
});

test("uses the midpoint for a booking made after the standard deadline", () => {
  assert.equal(
    finalDetailsDueISO({ eventDateISO: "2026-11-21", bookingDateISO: "2026-11-18" }),
    "2026-11-19",
  );
});
