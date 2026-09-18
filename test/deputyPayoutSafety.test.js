import test from "node:test";
import assert from "node:assert/strict";

// Keep module initialisation inert: no Stripe client is constructed.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.AUTO_DEPUTY_PAYOUTS_ENABLED;

const { isAutomaticDeputyPayoutEnabled, runDeputyPayoutRelease } =
  await import("../services/deputyPayoutService.js");
const { default: deputyJobModel } = await import("../models/deputyJobModel.js");
const { default: musicianModel } = await import("../models/musicianModel.js");

test("automatic deputy payouts are disabled by default", () => {
  assert.equal(isAutomaticDeputyPayoutEnabled({}), false);
  assert.equal(isAutomaticDeputyPayoutEnabled({ AUTO_DEPUTY_PAYOUTS_ENABLED: "false" }), false);
  assert.equal(isAutomaticDeputyPayoutEnabled({ AUTO_DEPUTY_PAYOUTS_ENABLED: "1" }), false);
  assert.equal(isAutomaticDeputyPayoutEnabled({ AUTO_DEPUTY_PAYOUTS_ENABLED: "true" }), true);
  assert.equal(isAutomaticDeputyPayoutEnabled({ AUTO_DEPUTY_PAYOUTS_ENABLED: " TRUE " }), true);
});

test("disabled payout run exits before querying jobs or calling Stripe", async () => {
  let transferCalls = 0;
  const result = await runDeputyPayoutRelease({
    allowTransfers: false,
    stripeClient: { transfers: { create: async () => { transferCalls += 1; } } },
  });

  assert.equal(result.disabled, true);
  assert.equal(result.releasedCount, 0);
  assert.equal(transferCalls, 0);
});

test("dry run reports eligible jobs without locking or transferring", async (t) => {
  const originals = {
    find: deputyJobModel.find,
    findOneAndUpdate: deputyJobModel.findOneAndUpdate,
  };
  t.after(() => Object.assign(deputyJobModel, originals));

  let lockCalls = 0;
  let transferCalls = 0;
  deputyJobModel.find = async () => [
    { _id: "job-preview", deputyNetAmount: 125.5, currency: "gbp" },
  ];
  deputyJobModel.findOneAndUpdate = async () => { lockCalls += 1; };

  const result = await runDeputyPayoutRelease({
    dryRun: true,
    allowTransfers: false,
    stripeClient: { transfers: { create: async () => { transferCalls += 1; } } },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.checkedCount, 1);
  assert.equal(result.results[0].amount, 125.5);
  assert.equal(lockCalls, 0);
  assert.equal(transferCalls, 0);
});

test("an enabled transfer uses a stable Stripe idempotency key", async (t) => {
  const job = {
    _id: "job-123",
    title: "Drums",
    workflowStage: "booking_confirmed",
    paymentStatus: "paid",
    payoutStatus: "scheduled",
    releaseOn: new Date("2026-01-01"),
    bookedMusicianId: "musician-1",
    deputyNetAmount: 100,
    grossAmount: 120,
    commissionAmount: 20,
    currency: "GBP",
    paymentEvents: [],
    saveCalls: 0,
    async save() { this.saveCalls += 1; return this; },
  };
  const musician = {
    _id: "musician-1",
    firstName: "Test",
    lastName: "Deputy",
    email: "",
    stripeConnect: {
      accountId: "acct_test_only",
      payoutsEnabled: true,
      detailsSubmitted: true,
    },
  };
  const originals = {
    find: deputyJobModel.find,
    findOneAndUpdate: deputyJobModel.findOneAndUpdate,
    musicianFindById: musicianModel.findById,
  };
  t.after(() => {
    deputyJobModel.find = originals.find;
    deputyJobModel.findOneAndUpdate = originals.findOneAndUpdate;
    musicianModel.findById = originals.musicianFindById;
  });

  deputyJobModel.find = async () => [job];
  deputyJobModel.findOneAndUpdate = async () => {
    job.payoutStatus = "pending";
    return job;
  };
  musicianModel.findById = () => ({ lean: async () => musician });

  let receivedOptions;
  const stripeClient = {
    transfers: {
      create: async (_params, options) => {
        receivedOptions = options;
        return { id: "tr_mock", status: "paid" };
      },
    },
  };

  const result = await runDeputyPayoutRelease({
    asOfDate: new Date("2026-02-01"),
    allowTransfers: true,
    stripeClient,
  });

  assert.equal(result.releasedCount, 1);
  assert.equal(job.payoutStatus, "paid");
  assert.deepEqual(receivedOptions, { idempotencyKey: "deputy-payout-job-123" });
});
