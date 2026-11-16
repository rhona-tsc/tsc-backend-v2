import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Act from '../models/actModel.js';
import merchantFeed from '../routes/merchantFeedRoutes.js';

test('each fetch reads current prices; database failure returns 503 instead of an empty catalogue', async t => {
  let price = 1831;
  let failed = false;
  t.mock.method(console, 'error', () => {});
  t.mock.method(Act, 'find', () => ({
    select() { return this; }, sort() { return this; },
    async lean() {
      if (failed) throw new Error('Database unavailable');
      return [{ _id: 'same-id', tscName: 'Example', slug: 'example', status: 'approved',
        tscDescription: 'Live band for weddings.', minDisplayPrice: price,
        coverImage: [{ url: 'https://example.com/band.jpg' }] }];
    },
  }));
  const app = express();
  app.use('/api/merchant', merchantFeed);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/merchant/acts.tsv`;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type'), /text\/tab-separated-values/);
  assert.match(first.headers.get('cache-control'), /no-store/);
  assert.match(await first.text(), /1831\.00 GBP/);
  price = 2000;
  assert.match(await (await fetch(url)).text(), /2000\.00 GBP/);
  failed = true;
  const unavailable = await fetch(url);
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /id\ttitle/);
});
