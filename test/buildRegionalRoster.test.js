import test from "node:test";
import assert from "node:assert/strict";
import { buildRegionalRoster } from "../utils/buildRegionalRoster.js";
import { websiteActView } from "../utils/websiteLineups.js";
let next = 0;
const newId = () => `id-${++next}`;
const profiles = {
  "Renes BBWI": { _id: "renes", firstName: "Renes", lastName: "BBWI" },
  "Matt Cook": { _id: "matt", firstName: "Matt", lastName: "Cook" },
};
const roster = {
  bandSizes: [6, 7, 8],
  roles: [
    {
      instrument: "Keyboard",
      instrumentPattern: "^Keyboard$",
      insert: true,
      primary: "Renes BBWI",
      primaryRegions: ["south"],
      pools: { south: ["Matt Cook", "Unmatched Player"], north: ["Matt Cook"] },
    },
    {
      instrument: "Trombone",
      instrumentPattern: "^Trombone$",
      primary: "Steph Ayton",
      primaryRegions: ["south"],
      pools: { south: [] },
    },
  ],
  extraLineup: { size: 9, copySize: 8, instrument: "Trombone" },
  exclusions: [],
};
const act = {
  lineups: [6, 7, 8]
    .map((n) => ({
      _id: `lineup-${n}`,
      lineupId: `uuid-${n}`,
      actSize: `${n}-Piece`,
      base_fee: [{ total_fee: 1234 }],
      bandMembers: Array.from({ length: n - 1 }, (_, i) => ({
        _id: `${n}-${i}`,
        instrument: `Role${i}`,
        deputies: [],
      })),
    }))
    .concat([
      {
        _id: "solo",
        actSize: "1-Piece",
        bandMembers: [{ instrument: "Saxophone" }],
      },
    ]),
};
const run = (a) =>
  buildRegionalRoster({
    act: a,
    roster,
    resolvePerson: (n) => profiles[n],
    newId,
    newLineupId: newId,
  });
test("restores one keys player to each declared band size, adds a separate ninth-player option and preserves solo slots", () => {
  const result = run(act);
  assert.deepEqual(
    result.lineups.map((l) => l.bandMembers.filter((m) => m.instrument).length),
    [6, 7, 8, 1, 9],
  );
  assert.equal(act.lineups[0].bandMembers.length, 5);
  assert.equal(result.lineups[3].bandMembers[0].instrument, "Saxophone");
  assert.deepEqual(result.lineups[4].base_fee, []);
});
test("one person shared across pools retains both regions and independent priority; unknown people stay pending", () => {
  const result = run(act),
    keys = result.lineups[0].bandMembers.at(-1);
  assert.equal(keys.deputies.length, 1);
  assert.deepEqual(keys.deputies[0].regions, ["south", "north"]);
  assert.deepEqual(keys.deputies[0].regionalPriority, { south: 0, north: 0 });
  assert.ok(
    result.policy.pendingMatches.some((p) => p.name === "Unmatched Player"),
  );
  assert.ok(result.policy.pendingMatches.some((p) => p.name === "Steph Ayton"));
});
test("rerunning the migration neither duplicates keys nor a ninth lineup, and retains unresolved names", () => {
  const first = run(act),
    second = run({ lineups: first.lineups });
  assert.equal(second.lineups.length, 5);
  assert.deepEqual(
    second.lineups.map((l) => l.bandMembers.length),
    first.lineups.map((l) => l.bandMembers.length),
  );
  assert.deepEqual(second.policy.pendingMatches, first.policy.pendingMatches);
});
test("a conflicting existing lineup size blocks mutation rather than silently changing performer counts", () => {
  assert.throws(
    () =>
      run({
        lineups: [
          {
            actSize: "6-Piece",
            bandMembers: Array.from({ length: 6 }, (_, i) => ({
              instrument: `Role${i}`,
            })),
          },
        ],
      }),
    /Review 6-Piece/,
  );
});
test("an allocation-only trombone option stays available to admin without publishing an unpriced website lineup", () => {
  const prepare = (act) =>
    buildRegionalRoster({
      act,
      roster: {
        ...roster,
        extraLineup: { ...roster.extraLineup, allocationOnly: true },
      },
      resolvePerson: (n) => profiles[n],
      newId,
      newLineupId: newId,
    });
  const first = prepare({ ...act, hiddenWebsiteLineupIds: ["already-hidden"] });
  assert.equal(first.lineups.length, 5);
  assert.equal(websiteActView(first).lineups.length, 4);
  assert.ok(first.hiddenWebsiteLineupIds.includes("already-hidden"));
  const second = prepare(first);
  assert.deepEqual(second.hiddenWebsiteLineupIds, first.hiddenWebsiteLineupIds);
});
test("a verified original profile links the existing slot without changing its name, fee or contact details", () => {
  const input = {
    ...act,
    lineups: act.lineups.map((l) => ({
      ...l,
      bandMembers: [
        ...l.bandMembers,
        {
          _id: "old-keys",
          instrument: "Keyboard",
          firstName: "Renes",
          lastName: "Original display name",
          fee: 275,
          email: "preserved@example.test",
          deputies: [],
        },
      ],
    })),
  };
  const result = run(input),
    member = result.lineups[0].bandMembers.at(-1);
  assert.equal(member.musicianId, "renes");
  assert.equal(member.lastName, "Original display name");
  assert.equal(member.email, "preserved@example.test");
  assert.equal(member.fee, 275);
  assert.equal(
    result.policy.pendingMatches.some((p) => p.name === "Renes BBWI"),
    false,
  );
});
test("allocation restrictions follow matched profile IDs and their display names", () => {
  const result = buildRegionalRoster({
    act,
    roster: {
      ...roster,
      exclusions: [
        {
          person: { name: "Renes BBWI" },
          withPeople: [{ name: "Matt Cook" }],
          reason: "Reviewed pairing restriction",
        },
      ],
    },
    resolvePerson: (n) => profiles[n],
    newId,
    newLineupId: newId,
  });
  assert.equal(result.policy.exclusions[0].person.musicianId, "renes");
  assert.equal(result.policy.exclusions[0].withPeople[0].musicianId, "matt");
});
