import test from "node:test";
import assert from "node:assert/strict";

import {
  getLineupDescriptionForPdf,
  getLineupMembersForPdf,
} from "../routes/bookingRoutes.js";

test("a booking-specific trumpet swap overrides the act's standard sax role", () => {
  const act = {
    lineups: [{
      lineupId: "six-piece",
      actSize: "6-Piece",
      bandMembers: [
        { instrument: "Lead Female Vocal" },
        { instrument: "Electric Guitar" },
        { instrument: "Keyboard" },
        { instrument: "Saxophone" },
        { instrument: "Bass Guitar" },
        { instrument: "Drums" },
      ],
    }],
  };
  const booking = {
    lineupId: "six-piece",
    lineupSelected: "6-Piece",
    lineupComposition: [
      "Lead Female Vocal",
      "Electric Guitar",
      "Keyboard",
      "Trumpet",
      "Bass Guitar",
      "Drums",
    ],
  };

  const members = getLineupMembersForPdf(booking, act);
  const description = getLineupDescriptionForPdf(booking, act);

  assert.deepEqual(members.map((member) => member.instrument), booking.lineupComposition);
  assert.match(description, /Trumpet/);
  assert.doesNotMatch(description, /Saxophone/);
});
