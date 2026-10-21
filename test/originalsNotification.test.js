import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOriginalProjectApprovedEmail,
  collectOriginalsNotificationRecipients,
  isOriginalsPreviewNotificationEmail,
} from "../services/originalsNotificationService.js";

test("Originals launch notifications are limited to the private preview audience", () => {
  assert.equal(isOriginalsPreviewNotificationEmail("tscRhona@gmail.com"), true);
  assert.equal(isOriginalsPreviewNotificationEmail("tsc+test@gmail.com"), true);
  assert.equal(isOriginalsPreviewNotificationEmail("ordinary@gmail.com"), false);
  assert.equal(isOriginalsPreviewNotificationEmail("musician@example.com"), false);
});

test("preview notification recipients include fixed addresses and de-duplicate musician records", () => {
  const recipients = collectOriginalsNotificationRecipients([
    { email: "TSCRhona@gmail.com", firstName: "Test Rhona" },
    { email: "tscrhona@gmail.com", firstName: "Duplicate" },
    { email: "rhona@thesupremecollective.co.uk", firstName: "Rhona" },
    { email: "someone@example.com", firstName: "No" },
  ]);
  assert.deepEqual(recipients.map((item) => item.email), [
    "ewanneilmcintosh@gmail.com",
    "hello@thesupremecollective.co.uk",
    "rhona@thesupremecollective.co.uk",
    "tscrhona@gmail.com",
  ]);
});

test("approved project email links directly to the workspace and lists roles", () => {
  const message = buildOriginalProjectApprovedEmail({
    project: {
      _id: "project123",
      title: "Soulful Test",
      ownerName: "Rhona Downie",
      genres: ["Soul", "Pop"],
      requestedRoles: [{ name: "Keys" }, { name: "Vocals" }],
    },
    firstName: "Ewan",
  });
  assert.match(message.subject, /Soulful Test/);
  assert.match(message.text, /Seeking: Keys, Vocals/);
  assert.match(message.projectUrl, /\/originals\/project123$/);
});
