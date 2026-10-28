import test from "node:test";
import assert from "node:assert/strict";

import Booking from "../models/bookingModel.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import {
  buildLinkedBookingAutomationUpdate,
  getCanonicalBookingKey,
  isSiteAutomationEnabled,
  mergeRowData,
  mergeSiteAutomationsEnabled,
  parseSiteAutomationsEnabled,
  readSiteAutomationsEnabled,
  resolveSiteAutomationsEnabled,
} from "../routes/bookingBoardRoutes.js";

test("legacy and new booking records default to site automations enabled", () => {
  assert.equal(isSiteAutomationEnabled(undefined), true);
  assert.equal(isSiteAutomationEnabled({}), true);

  const booking = new Booking({ bookingId: "AUTOMATION-DEFAULT" });
  const boardRow = new BookingBoardItem({ bookingRef: "AUTOMATION-DEFAULT" });

  assert.equal(booking.siteAutomationsEnabled, true);
  assert.equal(boardRow.siteAutomationsEnabled, true);
});

test("explicit false persists on both booking schemas", () => {
  const booking = new Booking({
    bookingId: "AUTOMATION-PAUSED",
    siteAutomationsEnabled: false,
  });
  const boardRow = new BookingBoardItem({
    bookingRef: "AUTOMATION-PAUSED",
    siteAutomationsEnabled: false,
  });

  assert.equal(booking.validateSync(), undefined);
  assert.equal(boardRow.validateSync(), undefined);
  assert.equal(booking.toObject().siteAutomationsEnabled, false);
  assert.equal(boardRow.toObject().siteAutomationsEnabled, false);
  assert.equal(isSiteAutomationEnabled(booking.toObject()), false);
  assert.equal(isSiteAutomationEnabled(boardRow.toObject()), false);
});

test("an explicit false survives merged booking-board records", () => {
  assert.equal(mergeSiteAutomationsEnabled({}, {}), true);
  assert.equal(
    mergeSiteAutomationsEnabled(
      { siteAutomationsEnabled: true },
      { siteAutomationsEnabled: undefined },
    ),
    true,
  );
  assert.equal(
    mergeSiteAutomationsEnabled(
      { siteAutomationsEnabled: true },
      { siteAutomationsEnabled: false },
    ),
    false,
  );
  assert.equal(
    mergeSiteAutomationsEnabled(
      { siteAutomationsEnabled: false },
      { siteAutomationsEnabled: true },
    ),
    false,
  );
});

test("API and CSV boolean values parse without treating textual false as true", () => {
  for (const value of [false, "false", " FALSE ", 0, "0", "no", "off", "disabled"]) {
    assert.equal(parseSiteAutomationsEnabled(value), false);
  }
  for (const value of [true, "true", " TRUE ", 1, "1", "yes", "on", "enabled"]) {
    assert.equal(parseSiteAutomationsEnabled(value), true);
  }
  for (const value of [undefined, null, "", "not-a-boolean"]) {
    assert.equal(parseSiteAutomationsEnabled(value), undefined);
  }

  assert.equal(
    readSiteAutomationsEnabled({ "Site Automations Enabled": "false" }),
    false,
  );
  assert.equal(
    readSiteAutomationsEnabled({ site_automations_enabled: "yes" }),
    true,
  );
  assert.equal(readSiteAutomationsEnabled({}), undefined);
});

test("manual or contract imports cannot overwrite an existing opt-out", () => {
  assert.equal(
    resolveSiteAutomationsEnabled({
      requestedValue: true,
      existingBooking: { siteAutomationsEnabled: false },
      existingBoardRow: null,
    }),
    false,
  );
  assert.equal(
    resolveSiteAutomationsEnabled({
      requestedValue: "true",
      existingBooking: null,
      existingBoardRow: { siteAutomationsEnabled: false },
    }),
    false,
  );
  assert.equal(
    resolveSiteAutomationsEnabled({
      requestedValue: "false",
      existingBooking: { siteAutomationsEnabled: true },
    }),
    false,
  );
});

test("an imported opt-out targets every linked core booking identity", () => {
  const operation = buildLinkedBookingAutomationUpdate(
    {
      bookingId: "507f1f77bcf86cd799439011",
      sourceBookingId: "507f191e810c19729de860ea",
      bookingRef: "BBM 497 DESIGN",
      sessionId: "session-497",
    },
    "false",
  );

  assert.deepEqual(operation, {
    filter: {
      $or: [
        {
          _id: {
            $in: [
              "507f1f77bcf86cd799439011",
              "507f191e810c19729de860ea",
            ],
          },
        },
        { bookingId: "BBM 497 DESIGN" },
        { sessionId: "session-497" },
      ],
    },
    update: { $set: { siteAutomationsEnabled: false } },
  });
  assert.equal(buildLinkedBookingAutomationUpdate({}, false), null);
  assert.equal(
    buildLinkedBookingAutomationUpdate({ bookingRef: "BBM 497 DESIGN" }, ""),
    null,
  );
});

test("canonical booking keys prefer human references over differing sessions", () => {
  assert.equal(
    getCanonicalBookingKey({
      bookingRef: "BBM 497 DESIGN",
      sessionId: "session-board",
    }),
    "booking:bbm 497 design",
  );
  assert.equal(
    getCanonicalBookingKey({
      bookingRef: "BBM 497 DESIGN",
      sessionId: "session-core",
    }),
    "booking:bbm 497 design",
  );
  assert.equal(
    getCanonicalBookingKey({ sessionId: "session-only" }),
    "session:session-only",
  );
});

test("merged automation rows keep the Booking Board act name separate from the public act name", () => {
  const websiteBooking = {
    bookingRef: "260915275050",
    actName: "Dancefloor Magic",
    actTscName: "Dancefloor Magic",
    grossValue: 5000,
  };
  const bookingBoardRow = {
    bookingRef: "260915275050",
    bookingBoardItemId: "board-row-id",
    actName: "Rhythm Mystique",
    actTscName: "Dancefloor Magic",
  };

  const merged = mergeRowData(websiteBooking, bookingBoardRow);

  assert.equal(merged.actName, "Rhythm Mystique");
  assert.equal(merged.actTscName, "Dancefloor Magic");
});
