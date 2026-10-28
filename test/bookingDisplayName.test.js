import test from "node:test";
import assert from "node:assert/strict";

import { resolveBookedActName } from "../utils/bookingDisplayName.js";

test("uses the Booking Board act name ahead of the public act name", () => {
  assert.equal(
    resolveBookedActName({
      board: {
        actName: "Rhythm Mystique",
        actTscName: "Dancefloor Magic",
      },
      booking: { actName: "Motown Magic" },
    }),
    "Rhythm Mystique",
  );
});

test("falls back to a public act name for legacy rows without a booked act name", () => {
  assert.equal(
    resolveBookedActName({
      board: { actTscName: "Dancefloor Magic" },
      booking: {},
    }),
    "Dancefloor Magic",
  );
});
