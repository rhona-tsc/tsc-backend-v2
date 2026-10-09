import test from "node:test";
import assert from "node:assert/strict";

import { setSharedIVR } from "../utils/proxySetup.js";

test("shared IVR accepts the booking eventDate and stores routing targets", () => {
  const previousNumber = process.env.TWILIO_SHARED_IVR_NUMBER;
  process.env.TWILIO_SHARED_IVR_NUMBER = "+442031111480";

  try {
    const booking = { eventDate: new Date("2026-11-07T12:00:00.000Z") };
    const targets = [
      {
        name: "Band leader",
        phone: "+447700900123",
        role: "Band Leader",
        priority: 1,
      },
    ];

    setSharedIVR(booking, { targets });

    assert.equal(booking.contactRouting.proxyNumber, "+442031111480");
    assert.match(booking.contactRouting.ivrCode, /^\d{5}$/);
    assert.deepEqual(booking.contactRouting.targets, targets);
    assert.equal(booking.eventSheet.emergencyContact.number, "+442031111480");
    assert.ok(booking.contactRouting.activeFrom instanceof Date);
    assert.ok(booking.contactRouting.activeUntil instanceof Date);
  } finally {
    if (previousNumber === undefined) {
      delete process.env.TWILIO_SHARED_IVR_NUMBER;
    } else {
      process.env.TWILIO_SHARED_IVR_NUMBER = previousNumber;
    }
  }
});

test("shared IVR does not invent an active window without an event date", () => {
  const booking = {};
  setSharedIVR(booking);
  assert.equal(booking.contactRouting, undefined);
});
