import test from "node:test";
import assert from "node:assert/strict";
import { buildRegionalRoster } from "../utils/buildRegionalRoster.js";
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
