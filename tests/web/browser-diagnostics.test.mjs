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

test('dense audio evidence protects every source fit and actual quantum without increasing the existing field or byte limits', () => {
  for (const controlMessageLimitBytes of [16 * 1024, 64 * 1024]) {
    const debug = { ...Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`optional${i}`, i])),
      contextState: 'running', contextRate: 48000, renderQuantumFrames: 128, renderQuantumMinFrames: 64, renderQuantumMaxFrames: 256,
      renderStatsState: 'available', renderUnderrunEvents: 7, renderUnderrunDurationMs: .123456, renderTotalDurationMs: 123750,
      deviceClockFitStatus: 'holdover', deviceClockFitRejectReason: 'noisy', deviceClockFitDispersionMs: 3.000001,
      deviceClockUncertaintyMs: 2.999999,
      deviceClockRatePpm: -1801.73, deviceClockConfidence: 0 };
    for (let stream = 0; stream < 8; stream++) debug[`stream${stream}`] = {
      ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`optional${i}`, i])),
      epoch: 10 + stream, state: 'rebuffering', lastRecoveryReason: 'network-buffer',
      sourceClockFitStatus: 'holdover', sourceClockFitRejectReason: 'noisy',
      sourceClockDispersionMs: .500001, sourceClockPoints: 121, sourceClockSpanMs: 120000,
      sourceClockAcceptedFitAgeMs: 3500, sourceClockFitRejected: 8,
    };
    const [, detail] = browserDiagnosticEvents({ transport: { controlMessageLimitBytes }, audio: { debug } }, false, true, 'capture');
    assert.ok(detail.v.omittedFields > 0);
    assert.ok(Object.keys(detail.v).length <= 256);
    const ordinary = 2048 - 24, budget = Math.min(16 * 1024, Math.floor((controlMessageLimitBytes - ordinary * 3 - 4096) / 2));
    assert.ok(Buffer.byteLength(JSON.stringify(detail.v)) <= budget);
    for (let stream = 0; stream < 8; stream++) {
      assert.equal(detail.v[`stream${stream}.epoch`], 10 + stream);
      assert.equal(detail.v[`stream${stream}.state`], 'rebuffering');
      assert.equal(detail.v[`stream${stream}.lastRecoveryReason`], 'network-buffer');
      assert.equal(detail.v[`stream${stream}.sourceClockFitStatus`], 'holdover');
      assert.equal(detail.v[`stream${stream}.sourceClockFitRejectReason`], 'noisy');
      assert.equal(detail.v[`stream${stream}.sourceClockDispersionMs`], .500001);
    }
    assert.equal(detail.v.renderQuantumFrames, 128); assert.equal(detail.v.renderQuantumMinFrames, 64); assert.equal(detail.v.renderQuantumMaxFrames, 256);
    assert.equal(detail.v.renderStatsState, 'available'); assert.equal(detail.v.renderUnderrunEvents, 7);
    assert.equal(detail.v.renderUnderrunDurationMs, .123456); assert.equal(detail.v.renderTotalDurationMs, 123750);
    assert.equal(detail.v.deviceClockUncertaintyMs, 2.999999); assert.equal(detail.v.deviceClockFitDispersionMs, 3.000001);
    assert.equal(detail.v.deviceClockFitStatus, 'holdover'); assert.equal(detail.v.deviceClockFitRejectReason, 'noisy');
    assert.equal(detail.v.deviceClockRatePpm, -1801.73); assert.equal(detail.v.deviceClockConfidence, 0);
    assert.equal(browserDiagnosticEvents({ audio: { debug } }, false, false).length, 1);
  }
});

test('clock dispersion retains six print decimals while ordinary audio numbers retain their existing rounding', () => {
  const [, detail] = browserDiagnosticEvents({ audio: { debug: { deviceClockUncertaintyMs: 2.9999994, deviceClockFitDispersionMs: 3.0000014,
    deviceClockRatePpm: 1.234567, stream6: { sourceClockDispersionMs: .5000014, sourceClockSpanMs: 30000.123456,
      sourceClockFitRejectReason: 'noisy', sourceClockAcceptedFitAgeMs: null },
    stream0: { sourceClockFitStatus: 'disabled', sourceClockFitRejectReason: 'buffered-prefetch' } } } }, false, true);
  assert.equal(detail.v.deviceClockUncertaintyMs, 2.999999); assert.equal(detail.v.deviceClockFitDispersionMs, 3.000001);
  assert.equal(detail.v['stream6.sourceClockDispersionMs'], .500001);
  assert.equal(detail.v.deviceClockRatePpm, 1.23);
  assert.equal(detail.v['stream6.sourceClockSpanMs'], 30000.12);
  assert.equal(Object.hasOwn(detail.v, 'stream6.sourceClockAcceptedFitAgeMs'), false);
  assert.equal(detail.v['stream0.sourceClockFitRejectReason'], 'buffered-prefetch');
});

test('unknown current device fit noise stays absent from Debug and ordinary summaries', () => {
  for (const unknown of [undefined, null, NaN, Infinity, -Infinity]) {
    const page = { audio: { debug: { deviceClockFitDispersionMs: unknown,
      deviceClockUncertaintyMs: .125123, deviceClockFitStatus: 'holdover', deviceClockFitRejectReason: 'noisy' } } };
    const [summary, detail] = browserDiagnosticEvents(page, false, true);
    assert.equal(Object.hasOwn(detail.v, 'deviceClockFitDispersionMs'), false);
    assert.equal(detail.v.deviceClockUncertaintyMs, .125123);
    assert.equal(Object.keys(summary.v).some(key => key.includes('deviceClockFitDispersionMs')), false);
    assert.equal(browserDiagnosticEvents(page, false, false).length, 1);
  }
});

test('retained source-deadline triggers precede optional fields fairly within the unchanged diagnostic budgets', () => {
  const fields = { lastSourceDeadlineDeltaUpperMs: 300.000001, lastSourceDeadlineUncertaintyMs: 8.164241,
    lastSourceDeadlineAgeMs: 12345.123457, lastSourceDeadlineLimitMs: 300 };
  for (const controlMessageLimitBytes of [16 * 1024, 64 * 1024]) {
    const debug = { ...Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`optional${i}`, i])),
      contextState: 'running', contextRate: 48000, renderQuantumFrames: 128 };
    for (let stream = 0; stream < 8; stream++) debug[`stream${stream}`] = {
      ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`optional${i}`, i])),
      epoch: 10 + stream, state: 'rebuffering', lastRecoveryReason: 'source-deadline', ...fields,
      sourceClockFitStatus: 'holdover', sourceClockFitRejectReason: 'noisy', sourceClockDispersionMs: .500001,
    };
    const [summary, detail] = browserDiagnosticEvents({ transport: { controlMessageLimitBytes }, audio: { debug } }, false, true, 'capture');
    assert.ok(detail.v.omittedFields > 0);
    assert.ok(Object.keys(detail.v).length <= 256);
    const budget = Math.min(16 * 1024, Math.floor((controlMessageLimitBytes - (2048 - 24) * 3 - 4096) / 2));
    assert.ok(Buffer.byteLength(JSON.stringify(detail.v)) <= budget);
    for (let stream = 0; stream < 8; stream++) {
      assert.equal(detail.v[`stream${stream}.epoch`], 10 + stream);
      assert.equal(detail.v[`stream${stream}.state`], 'rebuffering');
      assert.equal(detail.v[`stream${stream}.lastRecoveryReason`], 'source-deadline');
      for (const [key, value] of Object.entries(fields)) assert.equal(detail.v[`stream${stream}.${key}`], value);
    }
    assert.equal(Object.keys(summary.v).some(key => key.includes('lastSourceDeadline')), false);
    assert.equal(browserDiagnosticEvents({ audio: { debug } }, false).length, 1);
  }
});

test('source-deadline trigger values preserve threshold sides and omit unknown history', () => {
  const fields = ['lastSourceDeadlineDeltaUpperMs', 'lastSourceDeadlineUncertaintyMs', 'lastSourceDeadlineAgeMs', 'lastSourceDeadlineLimitMs'];
  const [, precise] = browserDiagnosticEvents({ audio: { debug: { stream0: Object.fromEntries(fields.map((key, i) => [key, 300 + i + .0000014])) } } }, false, true);
  for (let i = 0; i < fields.length; i++) assert.equal(precise.v[`stream0.${fields[i]}`], 300 + i + .000001);
  for (const unknown of [undefined, null, NaN, Infinity, -Infinity]) {
    const page = { audio: { debug: { stream6: { epoch: 9, ...Object.fromEntries(fields.map(key => [key, unknown])) } } } };
    const [, detail] = browserDiagnosticEvents(page, false, true);
    assert.equal(detail.v['stream6.epoch'], 9);
    for (const key of fields) assert.equal(Object.hasOwn(detail.v, `stream6.${key}`), false);
  }
});

test('the source-deadline selector fixture binds preserved trigger values to the native scalar schema', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/Browser-source-deadline-diagnostics-v1.json', import.meta.url), 'utf8'));
  const [, actual] = browserDiagnosticEvents(fixture.input.page, false, true, fixture.detail.d);
  assert.deepEqual(actual, fixture.detail);
  assert.equal(actual.v['stream0.sourceDeltaUpperMs'], 20);
  assert.equal(actual.v['stream0.lastSourceDeadlineDeltaUpperMs'], 300.000001,
    'the latest healthy sample cannot rewrite the retained triggering value');
});

test('retired deadline triggers retain their separate identity and precision within the existing Debug budget', () => {
  const retired = { lastRetiredSourceDeadlineEpoch: 8, lastRetiredSourceDeadlineGeneration: 5,
    lastRetiredSourceDeadlineDeltaUpperMs: 300.0000014, lastRetiredSourceDeadlineUncertaintyMs: 8.1642414,
    lastRetiredSourceDeadlineAgeMs: 12345.1234567, lastRetiredSourceDeadlineLimitMs: 300,
    retiredSourceDeadlineRejectedFrames: 240 };
  for (const controlMessageLimitBytes of [16 * 1024, 64 * 1024]) {
    const debug = { ...Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`optional${i}`, i])) };
    for (const stream of [0, 6, 255]) debug[`stream${stream}`] = { epoch: 9, state: 'playing', ...retired };
    const page = { transport: { controlMessageLimitBytes }, audio: { debug } };
    const [summary, detail] = browserDiagnosticEvents(page, false, true, 'capture');
    assert.ok(detail.v.omittedFields > 0);
    assert.ok(Object.keys(detail.v).length <= 256);
    const budget = Math.min(16 * 1024, Math.floor((controlMessageLimitBytes - (2048 - 24) * 3 - 4096) / 2));
    assert.ok(Buffer.byteLength(JSON.stringify(detail.v)) <= budget);
    for (const stream of [0, 6, 255]) {
      assert.equal(detail.v[`stream${stream}.epoch`], 9);
      for (const [field, value] of Object.entries(retired))
        assert.equal(detail.v[`stream${stream}.${field}`], Math.round(value * 1e6) / 1e6);
    }
    assert.equal(Object.keys(summary.v).some(key => key.includes('RetiredSourceDeadline') || key.includes('retiredSourceDeadline')), false);
    assert.equal(browserDiagnosticEvents(page, false).length, 1, 'no retired Debug evidence is collected into ordinary summaries');
  }
  for (const unknown of [undefined, null, NaN, Infinity, -Infinity]) {
    const page = { audio: { debug: { stream6: { epoch: 9,
      ...Object.fromEntries(Object.keys(retired).map(field => [field, unknown])) } } } };
    const [, detail] = browserDiagnosticEvents(page, false, true);
    assert.equal(detail.v['stream6.epoch'], 9);
    for (const field of Object.keys(retired)) assert.equal(Object.hasOwn(detail.v, `stream6.${field}`), false);
  }
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
