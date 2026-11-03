import test from "node:test";
import assert from "node:assert/strict";
import {
  finalDetailsDueISO,
  isWorkingDayISO,
  previousWorkingDayISO,
} from "../utils/finalDetailsDueDate.js";

test("uses Thursday in the week before a Saturday booking", () => {
  assert.equal(
    finalDetailsDueISO({ eventDateISO: "2026-11-21", bookingDateISO: "2026-09-27" }),
    "2026-11-12",
  );
});

test("uses the midpoint for a booking made after the standard deadline", () => {
  assert.equal(
    finalDetailsDueISO({ eventDateISO: "2026-11-21", bookingDateISO: "2026-11-18" }),
    "2026-11-19",
  );
});

test("moves a Christmas Eve deadline to the previous working day", () => {
  assert.equal(
    finalDetailsDueISO({ eventDateISO: "2026-12-31", bookingDateISO: "2026-01-15" }),
    "2026-12-23",
  );
});

test("treats weekends, England and Wales bank holidays, and Christmas Eve as closed", () => {
  assert.equal(isWorkingDayISO("2026-12-24"), false);
  assert.equal(isWorkingDayISO("2026-12-25"), false);
  assert.equal(isWorkingDayISO("2026-12-28"), false);
  assert.equal(isWorkingDayISO("2026-12-29"), true);
  assert.equal(previousWorkingDayISO("2026-12-28"), "2026-12-23");
});
