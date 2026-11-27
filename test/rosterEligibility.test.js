import test from "node:test";
import assert from "node:assert/strict";
import {
  rosterRegion,
  rosterEligibility,
  eligibleRosterDeputies,
  selectRosterMember,
} from "../utils/rosterEligibility.js";
const emma = {
  _id: "slot-e",
  musicianId: "emma",
  firstName: "Emma May",
  lastName: "Osei-Lah",
  instrument: "Lead Female Vocal/Rapper",
};
const kedesha = {
  _id: "slot-k",
  musicianId: "kedesha",
  firstName: "Kedesha",
  lastName: "Charles",
  instrument: "Lead Female Vocal",
};
const renes = {
  _id: "slot-r",
  musicianId: "renes",
  firstName: "Renes",
  lastName: "BBWI",
  instrument: "Keyboard",
  regions: ["south"],
  deputies: [
    {
      musicianId: "matt",
      name: "Matt Cook",
      regions: ["south", "north"],
      regionalPriority: { south: 0, north: 1 },
    },
    {
      musicianId: "stuart",
      name: "Stuart Darling",
      regions: ["south"],
      regionalPriority: { south: 1 },
    },
    {
      musicianId: "danielle",
      name: "Danielle Boniface",
      regions: ["north"],
      regionalPriority: { north: 0 },
    },
  ],
};
const lineup = { bandMembers: [emma, kedesha, renes] };
const policy = {
  exclusions: [
    {
      person: { musicianId: "renes", name: "Renes BBWI" },
      withPeople: [
        { musicianId: "emma", name: "Emma May Osei-Lah" },
        { musicianId: "kedesha", name: "Kedesha Charles" },
        {
          musicianId: "ione",
          name: "Ione Townsend",
          aliases: ["Miça Townsend"],
        },
      ],
      reason: "Use a keys deputy with these vocalists",
    },
  ],
};
test("regional county/postcode mapping follows North, South, Welsh and Scottish teams", () => {
  for (const [county, expected] of [
    ["London", "south"],
    ["Norfolk", "south"],
    ["Cheshire", "north"],
    ["Flintshire", "north"],
    ["Cardiff", "south"],
    ["Edinburgh", "scotland"],
  ])
    assert.equal(rosterRegion({ county }), expected);
  assert.equal(
    rosterRegion({ address: "London Road, Manchester, M1 1AE" }),
    "north",
  );
  assert.equal(rosterRegion({ address: "Venue TBC" }), "");
});
test("legacy unscoped deputies remain eligible; restricted deputies require a known eligible region", () => {
  const member = {
    deputies: [
      { musicianId: "legacy" },
      { musicianId: "southern", regions: ["south"] },
    ],
  };
  assert.equal(
    rosterEligibility({ candidate: { musicianId: "legacy" }, member }).eligible,
    true,
  );
  assert.equal(
    rosterEligibility({ candidate: { musicianId: "southern" }, member })
      .eligible,
    false,
  );
  assert.equal(
    rosterEligibility({
      candidate: { musicianId: "southern" },
      member,
      county: "Cheshire",
    }).eligible,
    false,
  );
});
test("regional priority and eligibility never mix the northern and southern pools", () => {
  assert.deepEqual(
    eligibleRosterDeputies({
      member: renes,
      lineup,
      policy,
      county: "London",
    }).map((p) => p.musicianId),
    ["matt", "stuart"],
  );
  assert.deepEqual(
    eligibleRosterDeputies({
      member: renes,
      lineup,
      policy,
      county: "Cheshire",
    }).map((p) => p.musicianId),
    ["danielle", "matt"],
  );
});
test("Renes automatically passes to the first eligible keys deputy with either original vocalist", () => {
  assert.equal(
    rosterEligibility({
      candidate: renes,
      member: renes,
      lineup,
      policy,
      county: "London",
    }).eligible,
    false,
  );
  assert.equal(
    selectRosterMember({ member: renes, lineup, policy, county: "London" })
      .musicianId,
    "matt",
  );
  assert.equal(
    selectRosterMember({ member: renes, lineup, policy, county: "Cheshire" })
      .musicianId,
    "danielle",
  );
});
test("actual replacement vocalists supersede originals; Renes may play when neither excluded vocalist is selected", () => {
  const assignments = [
    {
      musicianId: "whitney",
      name: "Whitney Williams",
      originalBandMemberId: "slot-k",
      status: "accepted",
    },
    {
      musicianId: "reese",
      name: "Reese Robinson",
      roleSlotId: "lead-female-vocal-rapper-1",
      status: "confirmed",
    },
  ];
  assert.equal(
    rosterEligibility({
      candidate: renes,
      member: renes,
      lineup,
      assignments,
      policy,
      county: "London",
    }).eligible,
    true,
  );
  assert.equal(
    selectRosterMember({
      member: renes,
      lineup,
      assignments,
      policy,
      county: "London",
    }).musicianId,
    "renes",
  );
});
test("Ione/Miça aliases still exclude Renes after both originals have replacements", () => {
  const assignments = [
    {
      name: "Miça Townsend",
      originalBandMemberId: "slot-k",
      status: "accepted",
    },
    {
      name: "Reese Robinson",
      originalBandMemberId: "slot-e",
      status: "confirmed",
    },
  ];
  assert.equal(
    rosterEligibility({
      candidate: renes,
      member: renes,
      lineup,
      assignments,
      policy,
      county: "London",
    }).eligible,
    false,
  );
});
test("reverse-order assignments and late acceptances cannot pair an excluded singer with already assigned Renes", () => {
  assert.equal(
    rosterEligibility({
      candidate: emma,
      member: emma,
      lineup,
      assignments: [
        {
          musicianId: "renes",
          name: "Renes BBWI",
          status: "accepted",
          originalBandMemberId: "slot-r",
        },
      ],
      policy,
      county: "London",
    }).eligible,
    false,
  );
  // Renes being an unassigned original must not prevent the preferred singers being approached.
  assert.equal(
    rosterEligibility({
      candidate: emma,
      member: emma,
      lineup,
      policy,
      county: "London",
    }).eligible,
    true,
  );
});
test("no eligible regional deputy never silently falls back to the wrong pool", () => {
  assert.equal(
    selectRosterMember({ member: renes, lineup, policy, county: "Edinburgh" }),
    null,
  );
  assert.equal(
    selectRosterMember({ member: renes, lineup, policy, address: "TBC" }),
    null,
  );
});

const rya = { musicianId: 'rya', name: 'Rya / Menat' };
const garageBass = { _id: 'garage-bass', musicianId: 'ewan', name: 'Ewan McIntosh', instrument: 'Bass Guitar', deputies: [rya] };
const garageMc = { _id: 'garage-mc', ...rya, instrument: 'MC/Rapper' };
const garageLineup = { bandMembers: [garageBass, garageMc] };
const garagePolicy = { exclusions: [{ person: rya, withPeople: [rya], reason: 'Rya cannot cover bass and vocals on the same booking' }] };
const replacementMc = { musicianId: 'shamyra', name: 'Shamyra Abbott', originalBandMemberId: 'garage-mc', status: 'confirmed' };
const assignedBass = { ...rya, originalBandMemberId: 'garage-bass', status: 'confirmed' };
const assignedMc = { ...rya, originalBandMemberId: 'garage-mc', status: 'confirmed' };
const garageEligibility = (member, assignments = []) => rosterEligibility({ candidate: rya, member, lineup: garageLineup, assignments, policy: garagePolicy });

test('Rya cannot cover bass while he remains the original MC', () => {
  assert.equal(garageEligibility(garageBass).eligible, false);
});
test('Rya may cover bass when an approved replacement covers the MC slot', () => {
  assert.equal(garageEligibility(garageBass, [replacementMc]).eligible, true);
});
test('Rya existing bass allocation remains eligible when he is not the MC', () => {
  assert.equal(garageEligibility(garageBass, [replacementMc, assignedBass]).eligible, true);
});
test('Rya cannot take the MC slot while he is allocated on bass', () => {
  assert.equal(garageEligibility(garageMc, [assignedBass]).eligible, false);
});
test('Rya existing MC allocation does not exclude itself', () => {
  assert.equal(garageEligibility(garageMc, [assignedMc]).eligible, true);
});
test('An inactive Rya bass allocation does not block his MC role', () => {
  for (const status of ['declined','cancelled','removed','unavailable','withdrawn'])
    assert.equal(garageEligibility(garageMc, [{ ...assignedBass, status }]).eligible, true);
});
