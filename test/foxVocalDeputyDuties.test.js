import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FOX_AND_THE_HOUNDS_ID, foxVocalDeputyDuties } from '../services/foxVocalDeputyDuties.js';

const resolve = input => foxVocalDeputyDuties({
  actId: FOX_AND_THE_HOUNDS_ID, isDeputy: true, musicianId: 'verified-guitarist',
  musician: { instrumentation: [{ instrument: 'Acoustic Guitar' }] },
  duties: 'Lead vocals/acoustic bass;2x60 or3x40,8–11pm. Setup before8pm. Enquiry only.',
  ...input,
});

test('Fox singing guitarist receives guitar duties, preserving timing and enquiry wording', () => {
  assert.equal(resolve(), 'Lead vocals/acoustic guitar;2x60 or3x40,8–11pm. Setup before8pm. Enquiry only.');
});

test('Rya/Menat uses the user-confirmed guitar role despite the older bass-only profile', () => {
  assert.equal(resolve({ musicianId: '692867e5e8e46d487634662e', musician: {
    instrumentation: [{ instrument: 'Electric Bass Guitar' }],
  }, duties: 'Vocalist-Bassist' }), 'Lead vocals / acoustic guitar');
});

test('approved named guitar leads do not inherit bass from incomplete profiles', () => {
  for (const musicianId of ['6946a408a034dd3ebd6a5aa5', '69453226a034dd3ebd6a4aa7', '6946af70a034dd3ebd6a6516']) {
    assert.equal(resolve({ musicianId, musician: { instrumentation: [] }, duties: 'Vocals/bass, 8–11pm' }),
      'Vocals/acoustic guitar, 8–11pm');
  }
});

test('verified acoustic bassist retains bass; electric bass alone does not imply acoustic guitar', () => {
  for (const instrumentation of [
    [{ instrument: 'Acoustic Bass Guitar' }, { instrument: 'Acoustic Guitar' }],
    [{ instrument: 'Electric Bass Guitar' }], [], [{ instrument: 'Electric Guitar' }],
  ]) {
    const duties = 'Vocalist-Bassist';
    assert.equal(resolve({ musician: { instrumentation }, duties }), duties);
  }
});

test('Richard, other acts, instrumental-only roles and already-correct guitar requests are unchanged', () => {
  const duties = 'Lead vocals/acoustic bass; standard sets';
  assert.equal(resolve({ isDeputy: false, duties }), duties);
  assert.equal(resolve({ actId: 'another-act', duties }), duties);
  assert.equal(resolve({ duties: 'Acoustic Bass Guitar' }), 'Acoustic Bass Guitar');
  assert.equal(resolve({ duties: 'Lead vocals/acoustic guitar; 7–10pm' }), 'Lead vocals/acoustic guitar; 7–10pm');
});

test('legacy compact acousticbass and vocalist/bass labels are corrected without dropping duties', () => {
  assert.equal(resolve({ duties: 'Lead vocals/acousticbass, 3–7pm with breaks' }), 'Lead vocals/acoustic guitar, 3–7pm with breaks');
  assert.equal(resolve({ duties: 'Vocalist/Bass Guitar; setup 5pm' }), 'Vocalist/acoustic guitar; setup 5pm');
});

test('actual automatic controller stores and sends guitar duties while retaining fees and prior-decline guards', () => {
  const output = execFileSync(process.execPath, ['--experimental-test-module-mocks',
    fileURLToPath(new URL('../scripts/test-fixtures/availabilityAutomaticRouting.fixture.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      DOTENV_CONFIG_PATH: '/dev/null', FOX_GUITAR_FIXTURE: '1' },
  });
  assert.match(output, /No live messages or database/);
});
