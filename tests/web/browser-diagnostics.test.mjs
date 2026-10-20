// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIO_DIAGNOSTIC_BYTES, PAGE_VERSION, browserDiagnosticEvents, createFaultDiagnosticReporter } from '../../site/play/browser-diagnostics.js';
import { VIDEO_COUNTER_FIELDS, VIDEO_VALUE_FIELDS } from '../../site/play/video-diagnostics.js';

function faultReporterFixture() {
  let at = 0, next = 0;
  const timers = new Map(), sent = [];
  const reporter = createFaultDiagnosticReporter({ emit: event => sent.push({ at, event }), now: () => at,
    schedule: (run, delay) => { const id = ++next; timers.set(id, { at: at + delay, run }); return id; },
    cancel: id => timers.delete(id) });
  return { reporter, sent, timers, advance(value) {
    const target = at + value;
    for (;;) {
      const task = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!task) break;
      const [id, timer] = task; timers.delete(id); at = timer.at; timer.run();
    }
    at = target;
  } };
}

test('fault identity churn retains the latest triggering snapshot within the regular diagnostic cadence', () => {
  const f = faultReporterFixture();
  f.reporter.report({ k: 'st', v: { epoch: 0 } });
  let event;
  for (let epoch = 1; epoch <= 1000; epoch++) f.reporter.report(event = { k: 'st', v: { epoch, rejected: epoch * 128 } });
  event.v.rejected = 0;
  assert.equal(f.sent.length, 1);
  assert.equal(f.timers.size, 1);
  f.advance(4999); assert.equal(f.sent.length, 1);
  f.advance(1);
  assert.deepEqual(f.sent.map(value => [value.at, value.event.v]), [[0, { epoch: 0 }], [5000, { epoch: 1000, rejected: 128000 }]]);
  assert.equal(f.timers.size, 0);
});

test('connection retirement cancels old pending faults without reopening the global immediate allowance', () => {
  const f = faultReporterFixture();
  f.reporter.report({ k: 'st', v: { epoch: 1 } });
  f.advance(100);
  f.reporter.report({ k: 'st', v: { epoch: 2 } });
  f.reporter.reset();
  assert.equal(f.timers.size, 0);
  f.reporter.report({ k: 'st', v: { epoch: 3 } });
  assert.equal(f.sent.length, 1);
  f.advance(4900);
  assert.deepEqual(f.sent.map(value => value.event.v.epoch), [1, 3]);
});

test('fault delivery failures cannot interrupt media feedback or cause an immediate retry loop', () => {
  let attempts = 0, at = 0, pending;
  const reporter = createFaultDiagnosticReporter({ emit() { attempts++; throw new Error('retired outbox'); }, now: () => at,
    schedule: run => { pending = run; return 1; }, cancel() {} });
  assert.doesNotThrow(() => reporter.report({ k: 'st', v: {} }));
  reporter.report({ k: 'st', v: {} });
  assert.equal(attempts, 1);
  at = 5000; pending();
  assert.equal(attempts, 2);
});

test('dense details reserve two protected fault summaries within a 16 KiB control message', () => {
  const page = { transport: { controlMessageLimitBytes: 16 * 1024 },
    video: { ...Object.fromEntries([...VIDEO_COUNTER_FIELDS, ...VIDEO_VALUE_FIELDS].map(key => [key, 123456789])),
      streamGeneration: 3, epoch: 7, mode: 'airplay-mirror', codec: 'avc1.640028' },
    audio: { debug: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`counter${i}`, 123456789])) } };
  const [regular, ...details] = browserDiagnosticEvents(page, false, true, 'capture');
  assert.equal(details.length, 2);
  assert.ok(details.every(event => event.v.omittedFields > 0), 'the test exercises dense snapshots, not empty details');
  const first = browserDiagnosticEvents(page, false)[0], terminal = browserDiagnosticEvents(page, false)[0];
  const touches = Array.from({ length: 16 }, (_, i) => ({ k: 't', p: [[0, .5, .5, i % 2], [1, .25, .75, i % 2]] }));
  const batch = { s: 'bounded-owner-session-1', q: 123456, e: [first, terminal, regular, ...details, ...touches,
    { k: 'vp', w: 1920, h: 1080, dpr: 2 }, { k: 'loc', lat: 0, lon: 0, accuracy: 5 }] };
  assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 16 * 1024);
});

test('busy video summaries retain cadence, audio and touch RTT within the ordinary budget', () => {
  const video = { ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`counter${i}`, i])),
    currentFps: 48, currentDelta: -19, frameIntervalP95Ms: 61, frameIntervalMaxMs: 128,
    pacingMode: 'display-refresh', pacingDroppedFrames: 3,
    playbackProfile: 'carplay-touch', decodedQueueFrames: 3, decodedQueueBytes: 24000000, decodedResourceDroppedFrames: 2 };
  const [event] = browserDiagnosticEvents({ video, control: { rttMsP95: 72, pending: 1 },
    audio: { sound: true, queuedBytes: 4096 } }, false);
  assert.equal(event.v['video.frameIntervalP95Ms'], 61);
  assert.equal(event.v['video.currentFps'], 48);
  assert.equal(event.v['video.pacingDroppedFrames'], 3);
  assert.equal(event.v['video.playbackProfile'], 'carplay-touch');
  assert.equal(event.v['video.decodedQueueBytes'], 24000000);
  assert.equal(event.v['control.rttMsP95'], 72);
  assert.equal(event.v['audio.queuedBytes'], 4096);
  assert.ok(JSON.stringify(event.v).length <= 2048);
});

test('transport failure and bounded resource evidence survives a busy video summary', () => {
  const transport = { transport: 'webrtc-datachannel', state: 'failed', reason: 'fragment-order', generation: 7,
    queuedBytes: 1000, highWaterBytes: 2048, reassemblyErrors: 1, controlFailures: 2,
    iceState: 'connected', connectionState: 'failed', fragmentsReceived: 1200, bytesReceived: 128000,
    recordsReceived: 100, recordsConsumed: 90, audioDiscardedRecords: 0, controlRequests: 72 };
  const video = { ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`counter${i}`, i])),
    currentFps: 48, currentDelta: -19, frameIntervalP95Ms: 61, frameIntervalMaxMs: 128,
    pacingMode: 'display-refresh', pacingDroppedFrames: 3 };
  const [event] = browserDiagnosticEvents({ video, transport, control: { rttMsP95: 72, pending: 1 },
    audio: { sound: true, queuedBytes: 4096 } }, false);
  for (const [key, value] of Object.entries(transport)) assert.equal(event.v[`transport.${key}`], value);
  assert.equal(event.v['audio.queuedBytes'], 4096);
  assert.equal(event.v['control.rttMsP95'], 72);
  assert.equal(event.v['video.frameIntervalP95Ms'], 61);
  assert.ok(JSON.stringify(event.v).length <= 2048);
});

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
  assert.equal(events.length, 3);
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

test('device drift and output rejection remain measurable after scalar telemetry rounding', () => {
  const [, detail] = browserDiagnosticEvents({ audio: { debug: { deviceClockRatePpm: -4000.125,
    outputUnavailableReason: 'feedback-distance', outputUnavailableCounts: { 'feedback-distance': 7 },
    stream0: { resampleRatio: 1.004016, resampleRatePpm: 4016.064, phaseCorrectionPpm: 0.125 } } } }, false, true);
  assert.equal(detail.v.deviceClockRatePpm, -4000.12);
  assert.equal(detail.v['stream0.resampleRatePpm'], 4016.06);
  assert.equal(detail.v['outputUnavailableCounts.feedback-distance'], 7);
  assert.equal(detail.v.outputUnavailableReason, 'feedback-distance');
});

test('selected ICE path and counters survive a crowded ordinary diagnostic summary', () => {
  const ice = { state: 'selected', localCandidateType: 'host', remoteCandidateType: 'host', protocol: 'udp',
    currentRoundTripTimeMs: 8, sampleAgeMs: 250, availableOutgoingBitrate: 12000000,
    requestsSent: 10, requestsReceived: 9, responsesSent: 9, responsesReceived: 10, bytesSent: 123456789, bytesReceived: 987654321 };
  const [event] = browserDiagnosticEvents({ transport: { ice },
    video: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`counter${i}`, i])) }, false);
  for (const [key, value] of Object.entries(ice)) assert.equal(event.v[`transport.ice.${key}`], value);
  assert.ok(JSON.stringify(event.v).length <= 2048);
});


test('the canonical Standard selector fixture preserves actual pairing, ICE, deadline and resource evidence across native delivery', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/Browser-standard-diagnostics-v1.json', import.meta.url), 'utf8'));
  const [actual] = browserDiagnosticEvents(fixture.input.page, fixture.input.themeDark);
  assert.deepEqual(actual, { k: fixture.k, v: fixture.v });
  for (const key of ['link.failure.reason', 'link.failure.stage', 'link.connection.stage',
    'link.connection.localCandidates', 'link.connection.localUdpCandidates', 'link.connection.remoteCandidates', 'link.connection.remoteUdpCandidates',
    'transport.ice.state', 'transport.ice.protocol', 'transport.ice.currentRoundTripTimeMs',
    'transport.video.retainedBytes', 'transport.video.receivedRecords',
    'audio.sourceDeadlineState', 'audio.sourceDeadlineReason', 'audio.sourceDeltaUpperMs',
    'audio.sourceDeadlineRejectedFrames', 'audio.sourceDeadlineStream', 'audio.sourceDeadlineEpoch',
    'video.decodeStalls', 'video.playbackProfile', 'control.rttMsP95']) assert.ok(key in actual.v, key);
  assert.ok(Buffer.byteLength(JSON.stringify(actual.v)) <= 2048);
});

test('a dense live policy summary retains owner, all drop components, actual target, capacity and both clock views', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/Browser-live-policy-diagnostics-v1.json', import.meta.url), 'utf8'));
  const [actual] = browserDiagnosticEvents(fixture.input.page, fixture.input.themeDark);
  assert.deepEqual(actual, fixture.standard);
  const source = fixture.input.page.video;
  for (const key of ['streamGeneration', 'epoch', 'droppedFrames', 'decodeDroppedFrames', 'scheduledDroppedFrames',
    'transferDroppedFrames', 'renderDroppedFrames', 'pacingDroppedFrames', 'playbackProfile', 'decodedQueueFrames',
    'decodedQueueBytes', 'scheduledCapacityFrames', 'currentDelta', 'currentFps', 'frameIntervalP95Ms',
    'policyVideoTargetMs', 'policyVideoReadinessMs', 'policyVideoMarginMs', 'policyMaxDelayMs', 'policySubmitMarginMs',
    'policyMaxVideoFrames', 'policyMaxVideoBytes', 'policyInteractionStarts', 'policyInteractionReleases',
    'policyProfileSwitches', 'sourceClockState', 'sourceClockAgeMs', 'clockEstimatorState',
    'clockEstimatorObservationAgeMs', 'clockEstimatorSelectedAgeMs']) assert.equal(actual.v[`video.${key}`], source[key], key);
  assert.equal(actual.v['transport.state'], 'failed'); assert.equal(actual.v['audio.sourceDeadlineState'], 'violated');
  assert.equal(actual.v['control.rttMsP95'], fixture.input.page.control.rttMsP95);
  assert.ok(Buffer.byteLength(JSON.stringify(actual.v)) <= 2048);
  assert.equal(actual.v['video.policyVideoPlanDurationMs'], undefined, 'full plan detail uses the separately bounded Debug record');
});
