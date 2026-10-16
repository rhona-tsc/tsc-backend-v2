import test from "node:test";
import assert from "node:assert/strict";

import {
  attachActProfileData,
  buildActProfileLookup,
} from "../utils/bookingActData.js";

test("booking rows without an act ID inherit add-ons by their TSC act name", () => {
  const extras = {
    up_to_3_hours_manned_playlist: { price: 50, complimentary: false },
  };
  const lookup = buildActProfileLookup([{
    _id: "6851719906472a53fe24f78c",
    name: "Committed to Kisstory",
    tscName: "Committed to Kisstory",
    extras,
  }]);

  const row = attachActProfileData({
    bookingRef: "BBM 497 DESIGN",
    actName: "Committed to Kisstory",
  }, lookup);

  assert.equal(row.actData.tscName, "Committed to Kisstory");
  assert.deepEqual(row.actData.extras, extras);
});

test("act-name matching is case insensitive", () => {
  const lookup = buildActProfileLookup([{
    _id: "act-id",
    name: "Committed to Kisstory",
    extras: { extra_song_request_per_band_member: { price: 10 } },
  }]);
  const row = attachActProfileData({ actTscName: "committed TO kisstory" }, lookup);
  assert.equal(row.actData.name, "Committed to Kisstory");
});
