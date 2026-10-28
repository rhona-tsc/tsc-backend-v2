import test from "node:test";
import assert from "node:assert/strict";

import { mergeRowData } from "../routes/bookingBoardRoutes.js";

test("Booking Board source remains authoritative when a core booking says Direct", () => {
  const merged = mergeRowData(
    {
      _id: "core-booking",
      bookingRef: "260915275050",
      agent: "Direct",
      updatedAt: "2026-10-28T12:00:00.000Z",
    },
    {
      _id: "board-row",
      bookingBoardItemId: "board-row",
      bookingRef: "260915275050",
      agent: "Entertainment Nation",
      updatedAt: "2026-10-28T11:00:00.000Z",
    },
  );

  assert.equal(merged.agent, "Entertainment Nation");
});

test("Booking Board source names are normalised consistently", () => {
  const merged = mergeRowData(
    {
      _id: "core-booking",
      bookingRef: "example",
      agent: "Direct",
    },
    {
      bookingBoardItemId: "board-row",
      bookingRef: "example",
      agent: " entertainment   nation ",
    },
  );

  assert.equal(merged.agent, "Entertainment Nation");
});

test("Booking Board venue and allocations survive a richer core booking merge", () => {
  const confirmedMusicians = [
    {
      musicianId: "6925e5a5b80ef19435354f2a",
      name: "Annie Afrilu",
      role: "Female Lead Vocals",
      status: "confirmed",
    },
  ];

  const merged = mergeRowData(
    {
      _id: "core-booking",
      bookingRef: "260915275050",
      actName: "Motown Magic",
      actTscName: "Dancefloor Magic",
      address: "Parsonage House, Parsonage Square, Dorking, RH4 1UP",
      assignedMusicians: [],
    },
    {
      bookingBoardItemId: "board-row",
      bookingRef: "260915275050",
      actName: "Rhythm Mystique",
      actTscName: "Dancefloor Magic",
      address:
        "Wotton House Hotel (Evelyn Suite), Guildford Rd, Wotton, Dorking, RH5 6HS",
      assignedMusicians: confirmedMusicians,
      bookingMusicians: confirmedMusicians,
      bandLineup: confirmedMusicians,
      bookingDetails: { assignedMusicians: confirmedMusicians },
    },
  );

  assert.equal(merged.actName, "Rhythm Mystique");
  assert.equal(merged.actTscName, "Dancefloor Magic");
  assert.equal(
    merged.address,
    "Wotton House Hotel (Evelyn Suite), Guildford Rd, Wotton, Dorking, RH5 6HS",
  );
  assert.equal(merged.assignedMusicians.length, 1);
  assert.equal(merged.assignedMusicians[0].name, "Annie Afrilu");
  assert.equal(merged.bookingDetails.assignedMusicians.length, 1);
});
