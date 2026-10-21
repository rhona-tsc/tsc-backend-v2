import test from "node:test";
import assert from "node:assert/strict";

import {
  attachActProfileData,
  buildActProfileLookup,
  findActLineup,
  findBestActProfile,
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

test("manual booking names tolerate a unique small typo", () => {
  const acts = [
    { _id: "dancefloor-id", name: "Motown Magic", tscName: "Dancefloor Magic" },
    { _id: "garage-id", name: "Gotta Be Garage", tscName: "Gotta Be Garage" },
  ];

  const match = findBestActProfile({ actTscName: "Dancefllor Magic" }, acts);
  assert.equal(match?._id, "dancefloor-id");
});

test("manual booking lineup labels resolve the matching piece size", () => {
  const fivePiece = {
    _id: "lineup-subdocument-id",
    lineupId: "five-piece-id",
    actSize: "5-Piece",
    bandMembers: [{}, {}, {}, {}, {}],
  };
  const act = {
    lineups: [
      { lineupId: "four-piece-id", actSize: "4-Piece", bandMembers: [{}, {}, {}, {}] },
      fivePiece,
    ],
  };

  const match = findActLineup(act, {
    lineupSelected: "5-Piece (Lead female vocal, bass, guitar, keys, drums)",
  });
  assert.equal(match, fivePiece);
});
