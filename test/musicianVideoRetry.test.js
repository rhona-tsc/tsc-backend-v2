import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import Video from "../models/musicianVideoSubmissionModel.js";
import { refreshMusicianVideoSubmission } from "../controllers/musicianVideoSubmissionController.js";

const musicianId = "111111111111111111111111";
const response = () => ({
  code: 200,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = () => ({ params: { submissionId: "222222222222222222222222" }, user: { id: musicianId } });

function setup(t, { failure = false, status = "manual_required", videoId = "" } = {}) {
  cloudinary.config({ cloud_name: "test", api_key: "test", api_secret: "test" });
  for (const key of ["AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP", "AZURE_VIDEO_INDEXER_ACCOUNT_NAME", "AZURE_VIDEO_INDEXER_ACCOUNT_ID", "AZURE_VIDEO_INDEXER_LOCATION", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"]) {
    const previous = process.env[key];
    process.env[key] = "test";
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const submission = {
    _id: "222222222222222222222222", musicianId, status, azureVideoId: videoId,
    cloudinaryPublicId: "saved-upload", cloudinaryFormat: "mp4", error: "Subscription disabled",
    moderationReason: "Automatic checking could not start", moderationFlags: [],
    save: async () => {},
  };
  t.mock.method(Video, "findById", async () => submission);
  const claim = t.mock.method(Video, "findOneAndUpdate", async (filter, update) => {
    assert.deepEqual(filter.status.$in, ["manual_required", "failed"]);
    assert.equal(filter.reviewedAt, null);
    assert.deepEqual(filter.azureVideoId.$in, ["", null]);
    if (!filter.status.$in.includes(submission.status) || submission.azureVideoId) return null;
    Object.assign(submission, update.$set);
    return submission;
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    if (String(url).includes("login.microsoftonline.com")) return { ok: true, text: async () => JSON.stringify({ access_token: "fake" }) };
    if (String(url).includes("generateAccessToken")) return { ok: true, text: async () => JSON.stringify({ accessToken: "fake" }) };
    if (String(url).includes("/Index")) return { ok: true, text: async () => JSON.stringify({ state: "Processed", videos: [{ insights: { ocr: [{ text: "Contact me" }] } }] }) };
    if (failure) return { ok: false, status: 403, text: async () => JSON.stringify({ error: { message: "Subscription disabled" } }) };
    return { ok: true, text: async () => JSON.stringify({ id: "azure-video-1", state: "Uploaded" }) };
  });
  return { submission, claim, requests };
}

test("refresh restarts a saved upload after an initial Azure failure, then polls without re-uploading", async (t) => {
  const { submission, requests } = setup(t);
  const res = response();
  await refreshMusicianVideoSubmission(request(), res);
  assert.equal(res.code, 200);
  assert.equal(submission.azureVideoId, "azure-video-1");
  assert.equal(submission.status, "processing");
  assert.equal(submission.error, "");
  const upload = new URL(requests.find(url => url.includes("/Videos?")));
  assert.match(upload.searchParams.get("videoUrl"), /saved-upload/);
  assert.equal(upload.searchParams.get("privacy"), "Private");
  await refreshMusicianVideoSubmission(request(), response());
  assert.equal(requests.filter(url => url.includes("/Videos?")).length, 1);
  assert.equal(submission.status, "manual_required");
  assert.equal(submission.moderationFlags[0].type, "visible_text");
});

test("concurrent refreshes claim only one Azure upload", async (t) => {
  const { requests } = setup(t);
  await Promise.all([refreshMusicianVideoSubmission(request(), response()), refreshMusicianVideoSubmission(request(), response())]);
  assert.equal(requests.filter(url => url.includes("/Videos?")).length, 1);
});

test("failed restart leaves the saved file available for another retry", async (t) => {
  const { submission } = setup(t, { failure: true });
  const res = response();
  await refreshMusicianVideoSubmission(request(), res);
  assert.equal(res.code, 500);
  assert.equal(submission.status, "manual_required");
  assert.equal(submission.azureVideoId, "");
  assert.equal(submission.cloudinaryPublicId, "saved-upload");
  assert.match(submission.moderationReason, /Subscription disabled/);
});

test("another musician cannot restart or read video checks", async (t) => {
  const { claim, requests } = setup(t);
  const req = request();
  req.user.id = "333333333333333333333333";
  const res = response();
  await refreshMusicianVideoSubmission(req, res);
  assert.equal(res.code, 403);
  assert.equal(claim.mock.callCount(), 0);
  assert.equal(requests.length, 0);
});

for (const status of ["rejected", "publishing", "published"]) {
  test(`refresh preserves ${status} decisions`, async (t) => {
    const { submission, claim, requests } = setup(t, { status, videoId: "existing" });
    await refreshMusicianVideoSubmission(request(), response());
    assert.equal(submission.status, status);
    assert.equal(claim.mock.callCount(), 0);
    assert.equal(requests.length, 0);
  });
}
