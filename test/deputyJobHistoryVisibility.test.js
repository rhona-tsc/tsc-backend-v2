import test from "node:test";
import assert from "node:assert/strict";

delete process.env.STRIPE_SECRET_KEY;

const { listDeputyJobs } = await import("../controllers/deputyJobController.js");
const { default: deputyJobModel } = await import("../models/deputyJobModel.js");

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("historical deputy posts are returned only to authorised admins", async (t) => {
  const originalAggregate = deputyJobModel.aggregate;
  const originalPopulate = deputyJobModel.populate;
  t.after(() => {
    deputyJobModel.aggregate = originalAggregate;
    deputyJobModel.populate = originalPopulate;
  });

  const records = [
    {
      _id: "historic-job",
      title: "Historic drums job",
      eventDate: "2000-01-01",
      status: "filled",
      updatedAt: new Date("2000-01-02"),
    },
    {
      _id: "future-job",
      title: "Future drums job",
      eventDate: "2099-01-01",
      status: "open",
      updatedAt: new Date(),
    },
  ];

  deputyJobModel.aggregate = async () => records.map((item) => ({ ...item }));
  deputyJobModel.populate = async (jobs) => jobs;

  const publicResponse = makeResponse();
  await listDeputyJobs(
    { query: { includeHistorical: "true" }, user: null },
    publicResponse,
  );
  assert.deepEqual(
    publicResponse.body.jobs.map((job) => job.title),
    ["Future drums job"],
  );
  assert.equal(publicResponse.body.canViewHistorical, false);

  const agentResponse = makeResponse();
  await listDeputyJobs(
    {
      query: { includeHistorical: "true" },
      user: { role: "agent", email: "another-agent@example.com" },
    },
    agentResponse,
  );
  assert.deepEqual(
    agentResponse.body.jobs.map((job) => job.title),
    ["Future drums job"],
  );

  const adminResponse = makeResponse();
  await listDeputyJobs(
    {
      query: { includeHistorical: "true" },
      user: { role: "agent", email: "hello@thesupremecollective.co.uk" },
    },
    adminResponse,
  );
  assert.deepEqual(
    adminResponse.body.jobs.map((job) => job.title),
    ["Historic drums job", "Future drums job"],
  );
  assert.equal(adminResponse.body.canViewHistorical, true);
  assert.equal(adminResponse.body.includeHistorical, true);
});
