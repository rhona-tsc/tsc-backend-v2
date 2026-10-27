import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWeddingReferralCode,
  isWeddingBooking,
} from "../utils/referralDiscountCode.js";

test("wedding referral codes are stable and booking-specific", () => {
  const first = { _id: "booking-one", eventType: "Wedding" };
  const second = { _id: "booking-two", eventType: "Wedding" };

  assert.match(buildWeddingReferralCode(first), /^TSC-WED-[A-F0-9]{10}$/);
  assert.equal(buildWeddingReferralCode(first), buildWeddingReferralCode(first));
  assert.notEqual(buildWeddingReferralCode(first), buildWeddingReferralCode(second));
});

test("referral codes are only generated for wedding bookings", () => {
  assert.equal(buildWeddingReferralCode({ _id: "private-party", eventType: "Private Party" }), "");
  assert.equal(isWeddingBooking({ bookingDetails: { eventType: "Wedding Reception" } }), true);
});
