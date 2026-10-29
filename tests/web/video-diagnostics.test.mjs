// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserDiagnosticEvents, PAGE_VERSION } from '../../site/play/browser-diagnostics.js';
import { createVideoDiagnosticTracker, safeSenderDiagnostics, videoDiagnosticValues, packVideoDiagnosticValues,
  VIDEO_DIAGNOSTIC_FIELDS, VIDEO_DIAGNOSTIC_BYTES, DROP_FIELDS, decoderStatsMatch, decoderStatsSnapshot } from '../../site/play/video-diagnostics.js';
import { performanceStats } from '../../site/play/fps-window.js';

const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/Browser-video-diagnostics-v1.json', import.meta.url)));
const video = extra => performanceStats({ streamGeneration: 3, epoch: 7, mode: 'carplay', readFrames: 100, decoded: 95, drawnFrames: 90,
  decodeDroppedFrames: 1, scheduledDroppedFrames: 2, transferDroppedFrames: 3, renderDroppedFrames: 4, pacingDroppedFrames: 5,
  timingRecords: 99999, ...extra });
const detail = events => events.find(event => event.k === 'video-diag');

test('current receiver RTP evidence crosses Debug packing without arbitrary getStats text or identities', () => {
  const page = { video: video(), transport: { rtpVideo: { state: 'selected', generation: 3, sampleAgeMs: 123,
    packetsReceived: 77, packetsLost: -1, packetsDiscarded: 2, framesAssembledFromMultiplePackets: 40,
    totalAssemblyTimeMs: 250, totalProcessingDelayMs: 400, totalInterFrameDelayMs: 1200,
    framesDecoded: 50, framesDropped: 2, jitterMs: 4,
    jitterBufferDelayMs: 900, jitterBufferEmittedCount: 50, powerEfficientDecoder: false,
    trackIdentifier: 'private-track', decoderImplementation: 'private-decoder', address: '192.0.2.10' } } };
  const event = detail(browserDiagnosticEvents(page, false, true, 'capture'));
  for (const key of ['generation', 'sampleAgeMs', 'packetsReceived', 'packetsLost', 'packetsDiscarded',
    'framesAssembledFromMultiplePackets', 'totalAssemblyTimeMs', 'totalProcessingDelayMs', 'totalInterFrameDelayMs', 'framesDecoded', 'framesDropped',
    'jitterMs', 'jitterBufferDelayMs', 'jitterBufferEmittedCount', 'powerEfficientDecoder', 'state'])
    assert.equal(event.v[`transport.rtpVideo.${key}`], page.transport.rtpVideo[key]);
  assert.doesNotMatch(JSON.stringify(event), /private-track|private-decoder|192\.0\.2\.10/);
  assert.ok(Object.keys(event.v).length <= 256); assert.ok(Buffer.byteLength(JSON.stringify(event.v)) <= VIDEO_DIAGNOSTIC_BYTES);
  const invalid = videoDiagnosticValues({ transport: { rtpVideo: { state: 'private-state', generation: .5,
    sampleAgeMs: -1, framesDecoded: Infinity, powerEfficientDecoder: 1 } } }, 'capture', createVideoDiagnosticTracker());
  assert.equal(Object.keys(invalid).some(key => key.startsWith('transport.rtpVideo.')), false);
});

test('decoder snapshot age includes worker delivery and grows without refreshing an old sample', () => {
  const sample = { streamGeneration: 7, epoch: 4, decoderStatsSampledAtMs: 10000, decoded: 30,
    decoderStatsAgeMs: 0, frameIntervalMaxMs: 190 };
  assert.equal(decoderStatsMatch(sample, 7, 4), true);
  assert.equal(decoderStatsSnapshot(sample, 10250).decoderStatsAgeMs, 250);
  assert.equal(decoderStatsSnapshot(sample, 11000).decoderStatsAgeMs, 1000);
  assert.equal(Object.hasOwn(decoderStatsSnapshot(sample, 11000), 'decoderStatsSampledAtMs'), false);
  assert.equal(Object.hasOwn(decoderStatsSnapshot(sample, 9999), 'decoderStatsAgeMs'), false);
  assert.equal(Object.hasOwn(decoderStatsSnapshot({ decoderStatsAgeMs: 0 }, 11000), 'decoderStatsAgeMs'), false);
  assert.equal(decoderStatsMatch(sample, 8, 4), false, 'old worker cannot refresh a replacement source');
  assert.equal(decoderStatsMatch(sample, 7, 5), false, 'old epoch cannot refresh a replacement codec');
  assert.equal(decoderStatsMatch(sample, 7, null), false, 'idle cannot acquire an old epoch sample');
  assert.equal(decoderStatsMatch({ streamGeneration: 7, epoch: null }, 7, undefined), true);
  assert.equal(decoderStatsMatch(undefined, undefined, undefined), false);
});

test('bounded st and Debug detail retain sample age, rare read gap and current decoder blockage', () => {
  const extra = { decoderStatsAgeMs: 250, readFrameIntervalMsMax: 190, decodeOldestInFlightMs: 284 };
  const entries = browserDiagnosticEvents({ video: video(extra) }, false, true, 'capture');
  for (const [key, value] of Object.entries(extra)) {
    assert.equal(entries[0].v[`video.${key}`], value);
    assert.equal(detail(entries).v[`raw.${key}`], value);
  }
  assert.equal(Object.hasOwn(detail(entries).v, 'raw.decoderStatsSampledAtMs'), false);
  const invalid = videoDiagnosticValues({ video: video({ decoderStatsAgeMs: -1,
    readFrameIntervalMsMax: -1, decodeOldestInFlightMs: -1 }) }, 'capture', createVideoDiagnosticTracker());
  for (const key of Object.keys(extra)) assert.equal(Object.hasOwn(invalid, `raw.${key}`), false);
});

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

test('the historical cross-language fixture remains accepted after additive diagnostics', () => {
  assert.equal(fixture.k, 'video-diag'); assert.equal(fixture.v.schema, 1);
  assert.ok(Object.keys(fixture.v).every(key => VIDEO_DIAGNOSTIC_FIELDS.includes(key)));
  assert.equal(fixture.v['interval.state'], 'valid'); assert.equal(fixture.v.streamGeneration, 3); assert.equal(fixture.v.epoch, 7);
  assert.equal(fixture.v['sender.authenticated'], true); assert.equal(fixture.v['control.inFlight'], true);
  assert.equal(fixture.v.omittedFields, 0);
  assert.ok(Object.keys(fixture.v).length <= 256); assert.ok(Buffer.byteLength(JSON.stringify(fixture.v)) <= VIDEO_DIAGNOSTIC_BYTES);
});

test('live policy fixture keeps exact cross-language fields while packing priority evidence into the unchanged budget', () => {
  const current = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/Browser-live-policy-diagnostics-v1.json', import.meta.url)));
  assert.deepEqual(current.schemaFields.sort(), [...VIDEO_DIAGNOSTIC_FIELDS].sort());
  const packed = packVideoDiagnosticValues(current.inputValues, PAGE_VERSION);
  assert.deepEqual({ ...current.debug.v, pageVersion: PAGE_VERSION }, packed);
  assert.equal(Object.keys(packed).length, 256); assert.equal(packed.omittedFields, 5);
  assert.ok(Buffer.byteLength(JSON.stringify(packed)) <= VIDEO_DIAGNOSTIC_BYTES);
  for (const key of ['streamGeneration', 'epoch', ...DROP_FIELDS.map(key => `raw.${key}`),
    'raw.playbackProfile', 'raw.policyVideoTargetMs', 'raw.policyVideoReadinessMs', 'raw.policyVideoMarginMs',
    'raw.policyInteractionStarts', 'raw.policyInteractionReleases', 'raw.policyProfileSwitches',
    'raw.policyVideoPlanDurationMs', 'raw.policyVideoPlanRemainingMs', 'raw.policyVideoLeadRemainingMs',
    'raw.sourceClockState', 'raw.sourceClockAgeMs', 'raw.clockEstimatorState', 'raw.clockEstimatorObservationAgeMs',
    'raw.clockEstimatorSelectedAgeMs', 'raw.decoderStatsAgeMs', 'raw.readFrameIntervalMsMax', 'raw.decodeOldestInFlightMs',
    'raw.decodeQueueSize', 'raw.decodedQueueFrames', 'raw.decodedQueueBytes', 'raw.decodeInFlightFrames', 'raw.decodeInFlightBytes',
    'raw.acceleration', 'raw.decoderImplementation']) assert.equal(packed[key], current.inputValues[key], key);
  const invalid = videoDiagnosticValues({ video: video({ policyVideoTargetMs: -1, policyInteractionStarts: .5,
    policyInteractionActive: 1, sourceClockAgeMs: -1, sourceClockState: 'private-url',
    clockEstimatorState: 'secret', clockEstimatorObservationAgeMs: -1 }) }, 'capture', createVideoDiagnosticTracker());
  for (const key of ['policyVideoTargetMs', 'policyInteractionStarts', 'policyInteractionActive', 'sourceClockAgeMs',
    'sourceClockState', 'clockEstimatorState', 'clockEstimatorObservationAgeMs']) assert.equal(invalid[`raw.${key}`], undefined);
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
