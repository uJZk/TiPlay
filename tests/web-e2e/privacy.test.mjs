// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairingCodeLeaks } from './privacy.mjs';

const code = '2718';
test('privacy oracle rejects semantic credentials in fields, URLs, nested JSON and diagnostic text', () => {
  for (const value of [{ c: code }, { code: 2718 }, { pairingCode: code }, { error: code },
    { request: '/rtc?%63=2718' }, { request: 'https://phone/rtc#c=2718' },
    { body: JSON.stringify({ nested: { code } }) }, { error: 'Incorrect pairing code: 2718.' }]) {
    assert.ok(pairingCodeLeaks(value, code).length, JSON.stringify(value));
  }
});
test('privacy oracle permits unrelated numeric measurements and opaque PAKE randomness', () => {
  const snapshot = { frames: 2718, clock: 1772718999.4, delta: '0.2718',
    proof: 'aeb2718abcdf2247a0123456789abcdef', request: 'http://127.0.0.1:2718/rtc/pair/start' };
  assert.equal(JSON.stringify(snapshot).includes(code), true, 'the previous substring oracle falsely rejects this legitimate snapshot');
  assert.deepEqual(pairingCodeLeaks(snapshot, code), []);
});
