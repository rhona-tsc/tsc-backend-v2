import test from "node:test";
import assert from "node:assert/strict";
import {
  ORIGINALS_OWNER_AGREEMENT_VERSION,
  canAccessOriginalsPreview,
  canRequestReservationExtension,
  canModerateOriginals,
  getReservationExpiry,
  getDueReservationReminder,
  isOriginalsEnabled,
  normaliseRequestedRoles,
  validateOriginalProjectForModeration,
} from "../services/originalsPolicyService.js";

test("Originals remains disabled unless explicitly enabled", () => {
  assert.equal(isOriginalsEnabled({}), false);
  assert.equal(isOriginalsEnabled({ ORIGINALS_ENABLED: "false" }), false);
  assert.equal(isOriginalsEnabled({ ORIGINALS_ENABLED: "1" }), false);
  assert.equal(isOriginalsEnabled({ ORIGINALS_ENABLED: " TRUE " }), true);
});

test("Originals private preview is limited to Rhona's allowlisted identities", () => {
  assert.equal(canAccessOriginalsPreview({ role: "agent", id: "68123dcda79759339808b578" }), false);
  assert.equal(canAccessOriginalsPreview({ role: "admin", id: "not-rhona" }), false);
  assert.equal(canAccessOriginalsPreview({ id: "693ac400ef2c3100595c0ed8" }), true);
  assert.equal(canAccessOriginalsPreview({ email: "HELLO@THESUPREMECOLLECTIVE.CO.UK" }), true);
});

test("reservations last 24 hours and allow no more than three extensions", () => {
  const start = new Date("2026-09-29T12:00:00.000Z");
  assert.equal(getReservationExpiry(start).toISOString(), "2026-09-30T12:00:00.000Z");
  assert.equal(getReservationExpiry(start, 12).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(canRequestReservationExtension({ state: "active", extensionCount: 2 }), true);
  assert.equal(canRequestReservationExtension({ state: "active", extensionCount: 3 }), false);
  assert.equal(canRequestReservationExtension({ state: "active", extensionCount: 1, extensionRequest: { status: "pending" } }), false);
});

test("reservation reminders are selected once at 12, 6, and 1 hours", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  const reservation = { state: "active", expiresAt: new Date("2026-09-29T17:30:00.000Z"), remindersSent: {} };
  assert.equal(getDueReservationReminder(reservation, now), "sixHour");
  reservation.remindersSent.sixHour = true;
  assert.equal(getDueReservationReminder(reservation, now), "");
  reservation.expiresAt = new Date("2026-09-29T12:30:00.000Z");
  assert.equal(getDueReservationReminder(reservation, now), "oneHour");
  reservation.state = "expired";
  assert.equal(getDueReservationReminder(reservation, now), "");
});

test("only TSC administrative identities can moderate Originals", () => {
  assert.equal(canModerateOriginals({ role: "musician" }), false);
  assert.equal(canModerateOriginals({ role: "agent" }), true);
  assert.equal(canModerateOriginals({ role: "admin" }), true);
  assert.equal(
    canModerateOriginals({ role: "musician", email: "hello@thesupremecollective.co.uk" }),
    true,
  );
});

test("requested roles are ordered, deduplicated, and retain foundation eligibility", () => {
  assert.deepEqual(
    normaliseRequestedRoles([
      { name: "Guitar", foundationEligible: true },
      { name: " guitar ", foundationEligible: false },
      { name: "Piano", foundationEligible: true },
    ]),
    [
      { name: "Guitar", order: 0, foundationEligible: true },
      { name: "Piano", order: 1, foundationEligible: true },
    ],
  );
});

test("a project without an initial stem requires a foundation-eligible role", () => {
  const base = {
    title: "New song",
    description: "A collaborative original",
    genres: ["Soul"],
    requestedRoles: [{ name: "Guitar", foundationEligible: false }],
    hasInitialStem: false,
    originalWorkConfirmed: true,
    ownerAgreement: {
      accepted: true,
      version: ORIGINALS_OWNER_AGREEMENT_VERSION,
    },
  };

  assert.deepEqual(validateOriginalProjectForModeration(base), [
    "At least one foundation-eligible role is required without an initial stem",
  ]);
  assert.deepEqual(
    validateOriginalProjectForModeration({
      ...base,
      requestedRoles: [{ name: "Guitar", foundationEligible: true }],
    }),
    [],
  );
});

test("moderation requires the exact current agreement version", () => {
  const errors = validateOriginalProjectForModeration({
    title: "New song",
    description: "A collaborative original",
    genres: ["Soul"],
    requestedRoles: [{ name: "Guitar", foundationEligible: true }],
    hasInitialStem: false,
    originalWorkConfirmed: true,
    ownerAgreement: { accepted: true, version: "outdated-version" },
  });

  assert.deepEqual(errors, ["The current owner agreement must be accepted"]);
});

test("anonymous owners require a credit alias and initial-stem projects require an asset", () => {
  const errors = validateOriginalProjectForModeration({
    title: "New song",
    description: "A collaborative original",
    genres: ["Soul"],
    requestedRoles: [{ name: "Guitar", foundationEligible: false }],
    hasInitialStem: true,
    initialAssetIds: [],
    ownerAnonymous: true,
    ownerCreditName: "",
    originalWorkConfirmed: true,
    ownerAgreement: {
      accepted: true,
      version: ORIGINALS_OWNER_AGREEMENT_VERSION,
    },
  });

  assert.deepEqual(errors, [
    "An artistic or credit name is required for an anonymous owner",
    "An initial stem must be uploaded when the project has a starting stem",
  ]);
});
