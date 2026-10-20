// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserDiagnosticEvents, PAGE_VERSION } from '../../site/play/browser-diagnostics.js';
import { createVideoDiagnosticTracker, safeSenderDiagnostics, videoDiagnosticValues, packVideoDiagnosticValues,
  VIDEO_DIAGNOSTIC_FIELDS, VIDEO_DIAGNOSTIC_BYTES, DROP_FIELDS } from '../../site/play/video-diagnostics.js';
import { performanceStats } from '../../site/play/fps-window.js';

const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/Browser-video-diagnostics-v1.json', import.meta.url)));
const video = extra => performanceStats({ streamGeneration: 3, epoch: 7, mode: 'carplay', readFrames: 100, decoded: 95, drawnFrames: 90,
  decodeDroppedFrames: 1, scheduledDroppedFrames: 2, transferDroppedFrames: 3, renderDroppedFrames: 4, pacingDroppedFrames: 5,
  timingRecords: 99999, ...extra });
const detail = events => events.find(event => event.k === 'video-diag');

test('ordinary telemetry always retains epoch and all five disjoint drop components ahead of optional counters', () => {
  const page = { video: video(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`counter${i}`, i]))),
    transport: { ice: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`counter${i}`, i])) } };
  const [event] = browserDiagnosticEvents(page, false);
  assert.equal(event.v['video.epoch'], 7); assert.equal(event.v['video.streamGeneration'], 3);
  assert.equal(event.v['video.droppedFrames'], 15);
  for (const [i, key] of DROP_FIELDS.entries()) assert.equal(event.v[`video.${key}`], i + 1);
  assert.ok(Buffer.byteLength(JSON.stringify(event.v)) <= 2048);
});

test('video detail is Debug-only, carries the capture gate and does not add reason subsets to total drops', () => {
  const page = { video: video({ touchSkippedFrames: 20, scheduledCoalescedFrames: 30, scheduledStaleFrames: 40, scheduledCapacityFrames: 50 }) };
  assert.equal(detail(browserDiagnosticEvents(page, false, false, 'capture')), undefined);
  const event = detail(browserDiagnosticEvents(page, false, true, 'capture'));
  assert.equal(event.d, 'capture'); assert.equal(event.v.schema, 1); assert.equal(event.v.pageVersion, PAGE_VERSION);
  assert.equal(event.v['raw.droppedFrames'], 15); assert.equal(event.v['raw.touchSkippedFrames'], 20);
  assert.equal(event.v['raw.touchSubset'], 'scheduledDroppedFrames');
  assert.equal(event.v['raw.schedulerReasonSubset'], 'scheduledDroppedFrames');
  assert.equal(event.v['raw.pipelineCounterScope'], 'pipeline-lifetime');
  assert.equal(event.v['raw.decodeDropCounterScope'], 'epoch-reset');
});

test('intervals compare only matching stream, epoch and capture samples and never invent a timing-record denominator', () => {
  let at = 0; const tracker = createVideoDiagnosticTracker({ now: () => at });
  const sample = (extra = {}, capture = 'capture') => {
    at += 1000;
    return detail(browserDiagnosticEvents({ video: video(extra) }, false, true, capture, tracker)).v;
  };
  assert.equal(sample()['interval.state'], 'baseline');
  const valid = sample({ readFrames: 110, decoded: 104, drawnFrames: 98, timingRecords: 100009, scheduledDroppedFrames: 3 });
  assert.equal(valid['interval.state'], 'valid'); assert.equal(valid['interval.durationMs'], 1000);
  assert.equal(valid['interval.readFrames'], 10); assert.equal(valid['interval.decoded'], 9); assert.equal(valid['interval.drawnFrames'], 8);
  assert.equal(valid['interval.scheduledDroppedFrames'], 1);
  assert.equal(valid['interval.timingRecords'], 10);
  assert.ok(!Object.keys(valid).some(key => /drop.*percent|drop.*ratio|denominator/i.test(key)));
  assert.equal(sample({ epoch: 8 })['interval.state'], 'source-change');
  assert.equal(sample({ epoch: 8 }, 'clear-capture')['interval.state'], 'capture-change');
  assert.equal(sample({ epoch: 8, readFrames: 1 }, 'clear-capture')['interval.state'], 'counter-reset');
  assert.equal(sample({ epoch: 8, streamGeneration: 4 }, 'clear-capture')['interval.state'], 'source-change');
  browserDiagnosticEvents({ video: video() }, false, false, 'clear-capture', tracker);
  assert.equal(sample()['interval.state'], 'baseline');
});

test('explicit selectors exclude addresses, SDP, codes, session and exception text and preserve typed scalars', () => {
  const sender = safeSenderDiagnostics({ authenticated: true, ready: true, session: 'private-session', failure: 'private SDP',
    networkMode: 'kernel-interfaces', address: '192.168.43.1', localCandidateCount: 2,
    video: { queueBytes: 100, recordsSent: 5, address: '169.254.111.111', nativeBufferedBytes: true },
    control: { nativeBufferedBytes: 300, bytesSent: 400 }, iceConnectionState: 'CONNECTED' });
  const values = videoDiagnosticValues({ video: video({ privateData: '9876', readFrames: true, drawnFrames: Infinity, touchCatchUpActive: true }),
    sender, transport: { ice: { protocol: 'udp', bytesSent: 42, address: '100.111.111.111', state: 'private-state' } },
    control: { inFlight: true, seq: false } }, 'private-capture', createVideoDiagnosticTracker());
  assert.equal(values['sender.authenticated'], true); assert.equal(values['raw.touchCatchUpActive'], true);
  assert.equal(values['control.inFlight'], true); assert.equal(values['sender.video.queueBytes'], 100);
  for (const key of ['sender.session', 'sender.failure', 'sender.video.nativeBufferedBytes', 'raw.readFrames', 'raw.drawnFrames', 'control.seq']) assert.equal(values[key], undefined);
  assert.doesNotMatch(JSON.stringify(values), /private-session|private SDP|private-capture|9876|192\.168|169\.254|100\.111/);
  assert.ok(Object.keys(values).every(key => VIDEO_DIAGNOSTIC_FIELDS.includes(key)));
});

test('production cross-language fixture covers every allowed field and retains finite raw and interval evidence', () => {
  assert.equal(fixture.k, 'video-diag'); assert.equal(fixture.v.schema, 1);
  assert.deepEqual(Object.keys(fixture.v).sort(), [...VIDEO_DIAGNOSTIC_FIELDS].sort());
  assert.equal(fixture.v['interval.state'], 'valid'); assert.equal(fixture.v.streamGeneration, 3); assert.equal(fixture.v.epoch, 7);
  assert.equal(fixture.v['sender.authenticated'], true); assert.equal(fixture.v['control.inFlight'], true);
  assert.equal(fixture.v.omittedFields, 0);
  assert.ok(Object.keys(fixture.v).length <= 256); assert.ok(Buffer.byteLength(JSON.stringify(fixture.v)) <= VIDEO_DIAGNOSTIC_BYTES);
});

test('negotiated control budgets contain dense audio/video/st plus RPC and representative touch/viewport', () => {
  const audio = { debug: Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`metric${i}`, '测'.repeat(40)])) };
  const full = Object.fromEntries(Object.keys(fixture.v).map(key => [key, fixture.v[key]]));
  for (const cap of [65536, 16384]) {
    const selected = prefix => Object.fromEntries(Object.entries(full).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
    const page = { video: video(), audio, sender: selected('sender.'), control: selected('control.'),
      transport: { controlMessageLimitBytes: cap, video: selected('transport.video.'), ice: selected('transport.ice.') } };
    // Use a dense production-shaped video snapshot rather than unrecognized opportunistic keys.
    for (const [key, value] of Object.entries(full)) if (key.startsWith('raw.')) page.video[key.slice(4)] = value;
    let at = 0; const tracker = createVideoDiagnosticTracker({ now: () => at });
    browserDiagnosticEvents(page, false, true, 'capture', tracker); at = 5000;
    const events = browserDiagnosticEvents(page, false, true, 'capture', tracker);
    if (cap === 16384) assert.ok(detail(events).v.omittedFields > 0, 'dense video is explicitly reduced to fit the negotiated batch');
    const rpc = { id: 12, type: 'control', q: 34, e: [...events,
      { k: 't', p: [[0, .2, .3, 1], [1, .7, .8, 1]] }, { k: 'vp', w: 1182, h: 920, cw: 1182, ch: 920, dpr: 1 }] };
    assert.ok(Buffer.byteLength(JSON.stringify(rpc)) < cap);
    assert.equal(events[0].k, 'st'); assert.ok(detail(events));
    for (const event of events.filter(event => event.k.endsWith('-diag'))) {
      assert.ok(Buffer.byteLength(JSON.stringify(event.v)) <= 16384); assert.ok(Object.keys(event.v).length <= 256);
    }
    assert.ok(events.find(event => event.k === 'audio-diag').v.omittedFields > 0);
  }
  const omitted = browserDiagnosticEvents({ video: video(), audio, transport: { controlMessageLimitBytes: 1024 } }, false, true, 'capture');
  assert.equal(omitted.length, 1); assert.ok(omitted[0].v.videoDiagnosticOmittedFields > 0);
  assert.ok(omitted[0].v.audioDiagnosticOmittedFields > 0);
  assert.ok(Buffer.byteLength(JSON.stringify({ id: 1, type: 'control', q: 1, e: omitted })) < 1024);
  const bounded = packVideoDiagnosticValues(fixture.v, PAGE_VERSION, 1024);
  assert.ok(bounded.omittedFields > 0); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 1024);
  assert.equal(bounded['raw.droppedFrames'], fixture.v['raw.droppedFrames']);
});
