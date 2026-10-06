import assert from "node:assert/strict";
import test from "node:test";

process.env.ADMIN_FRONTEND_URL =
  process.env.ADMIN_FRONTEND_URL || "https://admin.example.test";

test("deputy job email includes multi-date, multi-role and rate details", async () => {
  const { previewDeputyJobEmail } = await import(
    "../services/deputyJobNotifier.js"
  );

  const preview = await previewDeputyJobEmail({
    musician: {
      firstName: "Alex",
      matchedRoles: ["Saxophone", "Keys"],
    },
    job: {
      _id: "job-123",
      title: "Commercial shoot",
      instrument: "Trumpet",
      requiredInstruments: ["Trumpet", "Saxophone", "Keys"],
      roleRequirements: [
        { role: "Trumpet", quantity: 2 },
        { role: "Saxophone", quantity: 2 },
        { role: "Keys", quantity: 1 },
      ],
      eventDate: "2026-10-21",
      eventEndDate: "2026-10-22",
      fee: 180,
      feeBasis: "per_day",
      startTime: "08:00",
      endTime: "18:00",
      location: "Within the M25",
      setLengths: ["Full shoot day"],
      whatsIncluded: ["refreshments"],
      claimableExpenses: ["parking"],
      notes: "Bring your instrument.",
    },
  });

  assert.match(preview.text, /Wed, 21 Oct 2026 – Thu, 22 Oct 2026/);
  assert.match(preview.text, /Your matching roles: Saxophone, Keys/);
  assert.match(preview.text, /2 × Trumpet, 2 × Saxophone, 1 × Keys/);
  assert.match(preview.text, /Deputy fee: £180 per day/);
  assert.match(preview.text, /Included: refreshments/);
  assert.match(preview.text, /Claimable expenses: parking/);
  assert.match(preview.html, /All roles required/);
});
