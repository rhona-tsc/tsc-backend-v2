import test from "node:test";
import assert from "node:assert/strict";
import { getMemberCountyTravelFee } from "../utils/memberCountyTravel.js";

test("uses a musician county override ahead of the act's standard rate", () => {
  const member = { countyTravelFees: { "North Yorkshire": 160 } };
  assert.equal(getMemberCountyTravelFee(member, "north_yorkshire", 75), 160);
});

test("uses the act's standard rate when the musician has no override", () => {
  assert.equal(getMemberCountyTravelFee({}, "North Yorkshire", 75), 75);
});
