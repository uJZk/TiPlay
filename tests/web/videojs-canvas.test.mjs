// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shipped Canvas controls do not create native video elements for feature probes', async () => {
  const bundle = await readFile(new URL('../../site/play/vendor/videojs/player.min.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /createElement(?:NS)?\s*\([^)]*["']video["']/);
});
