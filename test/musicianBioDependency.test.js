import test from "node:test";
import assert from "node:assert/strict";
import musicianModel from "../models/musicianModel.js";
import { generateAndPublishMusicianBio } from "../services/musicianBioService.js";

test("updated AI client preserves biography and tagline requests and review flags without external calls", async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_BIO_MODEL;
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  delete process.env.OPENAI_BIO_MODEL;
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_BIO_MODEL;
    else process.env.OPENAI_BIO_MODEL = previousModel;
  });
  const source = {
    _id: "synthetic-musician", firstName: "Alex", lastName: "PrivateSurname",
    instrumentation: ["Guitar"], bio: "An experienced guitarist with a varied repertoire and a warm stage presence.",
  };
  t.mock.method(musicianModel, "findById", async () => ({ ...source, toObject: () => source }));
  const writes = [];
  t.mock.method(musicianModel, "updateOne", async (filter, update) => {
    assert.equal(filter._id, source._id);
    writes.push(update.$set);
    return { modifiedCount: 1 };
  });
  const biography = "Alex is an experienced guitarist with a varied repertoire.\n\nA warm stage presence supports engaging live performances.\n\nAlex brings versatility and musical care to every set.";
  const tagline = "Versatile guitarist with a varied repertoire and warm stage presence";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(body.model, "gpt-4o-mini");
    assert.deepEqual(body.messages.map(message => message.role), ["system", "user"]);
    assert.doesNotMatch(body.messages[1].content, /PrivateSurname/);
    return new Response(JSON.stringify({
      id: "synthetic-completion", object: "chat.completion", created: 0,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: requests.length === 1 ? biography : tagline } }],
    }), { headers: { "content-type": "application/json" } });
  });
  const result = await generateAndPublishMusicianBio(source._id);
  assert.equal(result.biography, biography);
  assert.equal(result.tagline, tagline);
  assert.equal(result.biographyGenerated, true);
  assert.equal(result.taglineGenerated, true);
  assert.deepEqual(requests.map(request => request.temperature), [0.45, 0.5]);
  assert.equal(writes[0].aiBioReviewRequired, true);
  assert.equal(writes[1].aiTaglineReviewRequired, true);
});
