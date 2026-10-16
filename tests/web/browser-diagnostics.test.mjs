// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIO_DIAGNOSTIC_BYTES, PAGE_VERSION, browserDiagnosticEvents } from '../../site/play/browser-diagnostics.js';

test('debug audio retains every stream independently of the ordinary video stats budget', () => {
  const debug = { contextState: 'running', pcmNonzero: 128, renderNonzero: 0 };
  for (let stream = 0; stream <= 6; stream++) debug[`stream${stream}`] = {
    epoch: 10, rate: 48000, channels: 2, queueBytes: 479232, queuePackets: 117,
    headMs: 1792120000000, tailMs: 1792120002496, playbackMs: 1792119999900,
    delayMs: 105, capacityPackets: 40, latePackets: 0, duplicatePackets: 0, playedPackets: 0,
  };
  const page = { video: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`counter${i}`, i])),
    audio: { sound: true, queuedBytes: 479232, debug } };
  const events = browserDiagnosticEvents(page, true, true, 'capture-cycle-1');
  assert.equal(events.length, 2);
  assert.ok(JSON.stringify(events[0].v).length <= 2048);
  assert.equal(events[0].v.themeDark, true);
  assert.ok(!Object.keys(events[0].v).some(key => key.startsWith('audio.debug')));
  const detail = events[1];
  assert.equal(detail.k, 'audio-diag');
  assert.equal(detail.d, 'capture-cycle-1');
  assert.equal(detail.v.pageVersion, PAGE_VERSION);
  assert.equal(detail.v.omittedFields, 0);
  for (let stream = 0; stream <= 6; stream++) {
    assert.equal(detail.v[`stream${stream}.playedPackets`], 0);
    assert.equal(detail.v[`stream${stream}.headMs`], 1792120000000);
  }
  assert.ok(JSON.stringify(detail.v).length <= AUDIO_DIAGNOSTIC_BYTES);
});

test('disabling Debug immediately excludes stale audio details and identifies oversized snapshots', () => {
  const page = { audio: { sound: true, debug: { contextState: 'running' } } };
  assert.equal(browserDiagnosticEvents(page, false, false).length, 1);
  const oversized = { audio: { debug: Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`counter${i}`, i])) } };
  const events = browserDiagnosticEvents(oversized, false, true);
  assert.ok(events[1].v.omittedFields > 0);
  assert.ok(JSON.stringify(events[1].v).length <= AUDIO_DIAGNOSTIC_BYTES);
});

test('the reported page version matches the service worker cache that loads it', () => {
  const worker = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8');
  assert.equal(worker.match(/const VERSION = '([^']+)'/)[1], PAGE_VERSION);
});
