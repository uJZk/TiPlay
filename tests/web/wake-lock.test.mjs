// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the receiver page allows the system display timeout during playback', () => {
  const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /navigator\.wakeLock/);
});
