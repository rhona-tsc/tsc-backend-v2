import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import Video from "../models/musicianVideoSubmissionModel.js";
import { thumbnailMediaUrl, isSupportedThumbnail } from "../services/musicianVideoThumbnailService.js";
import { getMusicianVideoThumbnail, uploadMusicianVideoThumbnail, reviewMusicianVideoThumbnail } from "../controllers/musicianVideoSubmissionController.js";

const owner = "111111111111111111111111";
const videoId = "222222222222222222222222";
const request = () => ({ params: { id: owner, submissionId: videoId }, user: { id: owner }, body: {} });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, set(headers) { this.headers = headers; return this; }, send(body) { this.body = body; return this; } });
const fixture = t => {
  const video = { _id: videoId, musicianId: owner, status: "manual_required", cloudinaryPublicId: "private/video", moderationFlags: [], save: async () => {} };
  t.mock.method(Video, "findById", async () => video);
  t.mock.method(Video, "findOneAndUpdate", async (filter, update) => {
    if (filter.thumbnailPublicId && filter.thumbnailPublicId !== video.thumbnailPublicId) return null;
    Object.assign(video, update.$set); return video;
  });
  return video;
};

test("existing authenticated videos get one generated still, reused on later requests", async t => {
  const video = fixture(t);
  const explicit = t.mock.method(cloudinary.uploader, "explicit", async (id, options) => {
    assert.equal(id, "private/video");
    assert.equal(options.type, "authenticated");
    assert.equal(options.resource_type, "video");
    assert.equal(options.eager[0].format, "jpg");
    return { eager: [{ secure_url: "https://res.cloudinary.com/test/video/authenticated/s--signed--/still.jpg" }] };
  });
  const first = await thumbnailMediaUrl(video);
  assert.equal(await thumbnailMediaUrl(video), first);
  assert.equal(explicit.mock.callCount(), 1);
});

test("thumbnail images remain protected from other musicians and mismatched profile paths", async t => {
  fixture(t);
  const explicit = t.mock.method(cloudinary.uploader, "explicit", async () => { throw Error("must not run"); });
  for (const change of [req => { req.user.id = "333333333333333333333333"; }, req => { req.params.id = "333333333333333333333333"; }]) {
    const req = request(); change(req); const res = response();
    await getMusicianVideoThumbnail(req, res);
    assert.equal(res.code, 404);
  }
  assert.equal(explicit.mock.callCount(), 0);
});

test("authorised thumbnail delivery sends only image bytes with private caching", async t => {
  const video = fixture(t);
  video.generatedThumbnailUrl = "https://res.cloudinary.com/test/still.jpg";
  t.mock.method(globalThis, "fetch", async url => { assert.equal(url, video.generatedThumbnailUrl); return { ok: true, arrayBuffer: async () => new Uint8Array([255,216,255]).buffer }; });
  const res = response(); await getMusicianVideoThumbnail(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.match(res.headers["Cache-Control"], /^private/);
  assert.ok(Buffer.isBuffer(res.body));
});

test("custom thumbnail upload persists without approving or changing the video", async t => {
  const video = fixture(t);
  t.mock.method(cloudinary.uploader, "upload_stream", (options, callback) => {
    assert.equal(options.type, "authenticated"); assert.equal(options.resource_type, "image");
    return { end() { callback(null, { public_id: "private/custom-image", format: "jpg" }); } };
  });
  const req = request();
  req.file = { buffer: Buffer.from([255,216,255,0]), mimetype: "image/jpeg", size: 4, originalname: "cover.jpg" };
  const res = response(); await uploadMusicianVideoThumbnail(req, res);
  assert.equal(res.code, 200);
  assert.equal(video.status, "manual_required");
  assert.equal(video.thumbnailReviewStatus, "pending");
  assert.equal(video.thumbnailPublicId, "private/custom-image");
  assert.equal(res.body.submission.thumbnailSource, "custom");
  assert.equal(res.body.submission.thumbnailPublicId, undefined);
});

test("rejects oversized files and files pretending to be images before uploading", async t => {
  fixture(t);
  const upload = t.mock.method(cloudinary.uploader, "upload_stream", () => { throw Error("must not run"); });
  for (const [file, code] of [
    [{ mimetype: "image/jpeg", buffer: Buffer.from("<svg/>"), size: 6 }, 415],
    [{ mimetype: "image/jpeg", buffer: Buffer.from([255,216,255]), size: 6 * 1024 * 1024 }, 413],
  ]) {
    const req = request(); req.file = file; const res = response();
    await uploadMusicianVideoThumbnail(req, res); assert.equal(res.code, code);
  }
  assert.equal(upload.mock.callCount(), 0);
  assert.equal(isSupportedThumbnail({ mimetype: "image/svg+xml", buffer: Buffer.from("<svg/>") }), false);
});

test("only staff can approve thumbnails", async t => {
  const video = fixture(t); video.thumbnailPublicId = "private/custom-image"; video.thumbnailReviewStatus = "pending";
  const req = request(); req.body.decision = "approve";
  const res = response(); await reviewMusicianVideoThumbnail(req, res);
  assert.equal(res.code, 403); assert.equal(video.thumbnailReviewStatus, "pending");
  req.user.role = "admin";
  const staffRes = response(); await reviewMusicianVideoThumbnail(req, staffRes);
  assert.equal(staffRes.code, 200); assert.equal(video.thumbnailReviewStatus, "approved");
  assert.equal(video.status, "manual_required");
});
