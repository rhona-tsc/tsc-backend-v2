import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBookingRefFromCalendarEvent,
  isOnlyActiveVocalist,
  isVocalRole,
} from "../utils/calendarBookingIdentity.js";

test("calendar booking reference prefers private extended properties", () => {
  assert.equal(
    extractBookingRefFromCalendarEvent({
      extendedProperties: { private: { bookingRef: "260922275836" } },
      description: "Booking Reference: wrong-reference",
    }),
    "260922275836",
  );
});

test("calendar booking reference falls back to the event description", () => {
  assert.equal(
    extractBookingRefFromCalendarEvent({
      description: "Act: Rhythm Mystique\nBooking Reference: 260922275836\nVenue: Test",
    }),
    "260922275836",
  );
});

test("vocal roles include lead and backing vocal labels", () => {
  assert.equal(isVocalRole("Lead Female Vocal"), true);
  assert.equal(isVocalRole("Backing Vocalist"), true);
  assert.equal(isVocalRole("Bass Guitar"), false);
});

test("the only confirmed vocalist requires manager approval", () => {
  const vocalist = {
    roleSlotId: "lead-female-vocal-1",
    role: "Lead Female Vocal",
    status: "confirmed",
  };
  assert.equal(
    isOnlyActiveVocalist({
      assignment: vocalist,
      assignments: [
        vocalist,
        { roleSlotId: "bass-1", role: "Bass Guitar", status: "confirmed" },
      ],
    }),
    true,
  );
});

test("a vocalist can use the deputy flow when another vocalist remains", () => {
  const vocalist = {
    roleSlotId: "lead-female-vocal-1",
    role: "Lead Female Vocal",
    status: "confirmed",
  };
  assert.equal(
    isOnlyActiveVocalist({
      assignment: vocalist,
      assignments: [
        vocalist,
        {
          roleSlotId: "lead-male-vocal-1",
          role: "Lead Male Vocal",
          status: "accepted",
        },
      ],
    }),
    false,
  );
});

test("instrumental roles never require vocalist approval", () => {
  assert.equal(
    isOnlyActiveVocalist({
      assignment: { role: "Keyboard", status: "confirmed" },
      assignments: [{ role: "Keyboard", status: "confirmed" }],
    }),
    false,
  );
});
