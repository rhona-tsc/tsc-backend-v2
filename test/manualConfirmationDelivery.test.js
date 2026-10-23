import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import TwilioMessageDelivery from "../models/twilioMessageDeliveryModel.js";

test("delivery records support email alerts without an SMS fallback", () => {
  const paths = TwilioMessageDelivery.schema.paths;

  assert.ok(paths.failureEmailTo);
  assert.ok(paths.failureEmailSubject);
  assert.ok(paths.failureEmailText);
  assert.ok(paths.failureEmailStatus);
  assert.ok(paths.failureEmailSentAt);
  assert.deepEqual(paths.failureEmailStatus.enumValues, [
    "not_required",
    "pending",
    "sending",
    "sent",
    "failed",
  ]);
});

test("manual booking confirmation disables SMS fallback and requests an admin email", () => {
  const source = readFileSync(
    new URL("../controllers/allocationController.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /manualConfirmation:\s*true/);
  assert.match(source, /allowSmsFallback:\s*!manualConfirmation/);
  assert.match(source, /source:\s*manualConfirmation[\s\S]*manual-booking-confirmation/);
  assert.match(source, /No SMS fallback was sent/);
});

test("delivery failure webhook claims each email alert once", () => {
  const source = readFileSync(
    new URL("../controllers/availabilityController.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /failureEmailStatus:\s*"pending"/);
  assert.match(source, /failureEmailStatus:\s*"sending"/);
  assert.match(source, /failureEmailStatus:\s*emailResult\?\.ok\s*\?\s*"sent"\s*:\s*"failed"/);
});
