import test from "node:test";
import assert from "node:assert/strict";
import { calculateOriginalsSplits, totalPercent } from "../services/originalsRoyaltyService.js";

const production = [
  { category: "mix", musicianId: "mix", roleName: "Mix producer" },
  { category: "master", musicianId: "master", roleName: "Mastering engineer" },
];

test("master income follows the agreed 20/20/40/10/10 allocation", () => {
  const splits = calculateOriginalsSplits({
    project: { ownerId: "owner", hasInitialStem: true },
    acceptedSubmissions: [
      { category: "contribution", musicianId: "guitarist", roleName: "Guitar", songwritingChoice: "master_only" },
      { category: "contribution", musicianId: "bassist", roleName: "Bass", songwritingChoice: "songwriting_claim" },
      ...production,
    ],
  });
  assert.equal(totalPercent(splits.master), 100);
  assert.deepEqual(splits.master.map(({ role, percent }) => [role, percent]), [
    ["TSC", 20], ["Project owner", 20], ["Guitar", 20], ["Bass", 20], ["Mix producer", 10], ["Mastering engineer", 10],
  ]);
});

test("an initial-stem owner receives unclaimed composition units", () => {
  const splits = calculateOriginalsSplits({
    project: { ownerId: "owner", hasInitialStem: true },
    acceptedSubmissions: [
      { category: "contribution", musicianId: "guitarist", roleName: "Guitar", songwritingChoice: "master_only" },
      { category: "contribution", musicianId: "bassist", roleName: "Bass", songwritingChoice: "songwriting_claim" },
      ...production,
    ],
  });
  assert.equal(totalPercent(splits.composition), 100);
  assert.equal(splits.composition.find((share) => share.recipientType === "owner").percent, 66.666667);
  assert.equal(splits.composition.find((share) => share.recipientId === "bassist").percent, 33.333333);
});

test("a non-final guide or video can preserve the owner's songwriting claim", () => {
  const splits = calculateOriginalsSplits({
    project: { ownerId: "owner", hasInitialStem: false, ownerSongwritingClaim: true },
    acceptedSubmissions: [
      { category: "contribution", musicianId: "pianist", roleName: "Piano", songwritingChoice: "master_only" },
      ...production,
    ],
  });
  assert.deepEqual(splits.composition.map(({ recipientId, percent }) => [recipientId, percent]), [["owner", 100]]);
});

test("a project without a stem splits composition among claimers, or everybody if nobody claims", () => {
  const base = [
    { category: "contribution", musicianId: "guitarist", roleName: "Guitar", songwritingChoice: "master_only" },
    { category: "contribution", musicianId: "bassist", roleName: "Bass", songwritingChoice: "master_only" },
  ];
  const nobodyClaims = calculateOriginalsSplits({ project: { ownerId: "owner", hasInitialStem: false }, acceptedSubmissions: [...base, ...production] });
  assert.deepEqual(nobodyClaims.composition.map((share) => share.percent), [50, 50]);
  const oneClaims = calculateOriginalsSplits({ project: { ownerId: "owner", hasInitialStem: false }, acceptedSubmissions: [{ ...base[0], songwritingChoice: "songwriting_claim" }, base[1], ...production] });
  assert.deepEqual(oneClaims.composition.map(({ recipientId, percent }) => [recipientId, percent]), [["guitarist", 100]]);
});

test("credits cannot be calculated without exactly one accepted mix and master", () => {
  assert.throws(() => calculateOriginalsSplits({ project: { ownerId: "owner" }, acceptedSubmissions: [{ category: "contribution", musicianId: "g", roleName: "Guitar" }] }), /accepted mix/);
});
