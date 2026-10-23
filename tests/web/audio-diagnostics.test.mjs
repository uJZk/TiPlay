// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';
import { browserDiagnosticEvents } from '../../site/play/browser-diagnostics.js';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';
import { PcmTimeline } from '../../site/play/pcm-timeline.js';
import { constantDelay } from '../../site/play/delay-plan.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { BUFFERED_AUDIO_WINDOW_MS, BUFFERED_FEED_LEAD_MS, BUFFERED_START_LATENCY_MS, AUDIO_CLOCK_MARGIN_MS, MAX_AUDIO_AHEAD_BYTES } from '../../site/play/audio-buffer-policy.js';

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
await import('../../site/play/audio-worklet.js');

function replay({ previousLimit = false, videoDelay = 0, audioDelay = 105, clockShift = 20 } = {}) {
  const processor = new Processor(), frameMs = 1024 * 1000 / 48000, base = 1792129412763;
  processor.port.onmessage({ data: { debug: true, clockBase: base,
    plans: { video: constantDelay(videoDelay), audio: constantDelay(audioDelay) } } });
  let next = 0, nonzero = 0, samples = 0;
  for (let block = 0; block < 3000; block++) {
    const wall = block * 128 / 48;
    globalThis.currentTime = wall / 1000;
    while (Math.max((next + 1) * frameMs - BUFFERED_FEED_LEAD_MS, next * frameMs / 4) <= wall) {
      processor.port.onmessage({ data: { type: 0, mode: 'carplay', epoch: 7, generation: 3,
        rate: 48000, channels: 2, flags: 1, sequence: next,
        sourceTime: base + BUFFERED_START_LATENCY_MS + next * frameMs + clockShift,
        pcm: new Int16Array(2048).fill(8192).buffer } });
      if (previousLimit) Object.assign(processor.timelines.get(0), { maximumMs: 2500, buffered: false });
      next++;
    }
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([], [output]);
    if (wall > 3000) { samples += 128; nonzero += output[0].filter(value => value !== 0).length; }
    assert.ok(processor.timelines.get(0).bytes <= MAX_AUDIO_AHEAD_BYTES);
  }
  processor.report();
  return { audible: nonzero / samples, processor, stats: processor.messages.filter(value => value.diagnostics).at(-1).diagnostics };
}

test('the real worklet reproduces prior buffered starvation and retains audio across the full timing budget', () => {
  assert.equal(replay({ previousLimit: true }).audible, 0, 'the captured 2500ms policy continually discarded the sample before playback');
  for (const options of [{}, { videoDelay: 500, audioDelay: 625, clockShift: AUDIO_CLOCK_MARGIN_MS }]) {
    const { audible, processor, stats } = replay(options);
    assert.ok(audible > 0.999, 'nonzero PCM remains continuous at the maximum allowed delay and clock margin');
    assert.equal(stats.stream0.capacityPackets, 0); assert.ok(stats.stream0.playedPackets > 0);
    assert.equal(stats.renderPeak, 0.25); assert.ok(stats.renderNonzero > 0);
    const timeline = processor.timelines.get(0);
    assert.ok(timeline.queue.at(-1).end - timeline.queue[0].start <= BUFFERED_AUDIO_WINDOW_MS);
  }
});

test('realtime CarPlay media retains its one-second sender lead across a delayed audio clock', () => {
  const processor = new Processor(), frameMs = 1024 * 1000 / 48000, base = 1792129412763;
  const senderLeadMs = 1000, audioClockLagMs = 925;
  processor.port.onmessage({ data: { debug: true, clockBase: base - audioClockLagMs,
    plans: { video: constantDelay(0), audio: constantDelay(20) } } });
  let next = 0, nonzero = 0, samples = 0, maximumBytes = 0;
  for (let block = 0; block < 3000; block++) {
    const wall = block * 128 / 48;
    globalThis.currentTime = wall / 1000;
    while (next * frameMs <= wall) {
      processor.port.onmessage({ data: { type: 0, mode: 'carplay', epoch: 9, generation: 4,
        rate: 48000, channels: 2, flags: 0, sequence: next,
        sourceTime: base + senderLeadMs + next * frameMs,
        pcm: new Int16Array(2048).fill(8192).buffer } });
      next++;
    }
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([], [output]);
    maximumBytes = Math.max(maximumBytes, processor.timelines.get(0).bytes);
    if (wall > 3000) { samples += 128; nonzero += output[0].filter(value => value !== 0).length; }
  }
  processor.report();
  const stats = processor.messages.filter(value => value.diagnostics).at(-1).diagnostics;
  assert.ok(nonzero / samples > 0.999, 'realtime media must retain the sample until its existing presentation deadline');
  assert.equal(stats.stream0.capacityPackets, 0, 'the negotiated sender lead must fit without evicting audio before playback');
  assert.ok(stats.stream0.playedPackets > 0);
  assert.ok(maximumBytes <= MAX_AUDIO_AHEAD_BYTES);
  assert.equal(processor.timelines.get(0).buffered, false, 'UDP media retains its realtime overflow policy');

  for (const [type, mode, flags, maximumMs, buffered] of [
    [0, 'carplay', 1, BUFFERED_AUDIO_WINDOW_MS, true],
    [1, 'carplay', 0, 1000, false],
    [6, 'airplay-mirror', 4, 1000, false],
  ]) {
    const other = new Processor();
    other.port.onmessage({ data: { type, mode, epoch: 1, flags, sequence: 0,
      rate: 48000, channels: 2, sourceTime: base, pcm: new Int16Array(2048).buffer } });
    assert.equal(other.timelines.get(type).maximumMs, maximumMs);
    assert.equal(other.timelines.get(type).buffered, buffered);
  }
});

test('buffered overflow protects the sample about to play and diagnostics separate all retirement reasons', () => {
  const audio = new PcmTimeline(8000, 1, () => {}, 100, { buffered: true });
  audio.debug(true);
  const packet = (sourceTime, sequence) => ({ sourceTime, sequence, pcm: new Int16Array(80).fill(16384).buffer });
  audio.push(packet(0, 0)); audio.push(packet(0, 0));
  for (let index = 1; index < 50; index++) audio.push(packet(index * 10, index));
  assert.equal(audio.sample(0, 0), 0.5, 'future arrivals cannot starve the retained head');
  audio.sample(10, 0);
  audio.push(packet(-10, 60));
  audio.sample(200, 0);
  audio.push(packet(300, 70)); audio.clear();
  const stats = audio.stats();
  assert.ok(stats.capacityPackets > 0); assert.equal(stats.duplicatePackets, 1);
  assert.ok(stats.playedPackets > 0); assert.ok(stats.latePackets > 0); assert.equal(stats.resetPackets, 1);
  assert.equal(stats.queueBytes, 0);
  audio.debug(false); assert.equal(audio.counters, null);
});

test('worklet scalar telemetry is opt-in, rate-limited and stops immediately when disabled', () => {
  const processor = new Processor(); globalThis.currentTime = 0;
  const output = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [output]); assert.equal(processor.messages.length, 0);
  processor.port.onmessage({ data: { debug: true } });
  processor.process([], [output]);
  assert.equal(processor.messages.filter(value => value.diagnostics).length, 1);
  globalThis.currentTime = 0.1; processor.process([], [output]);
  assert.equal(processor.messages.filter(value => value.diagnostics).length, 1);
  globalThis.currentTime = 0.5; processor.process([], [output]);
  assert.equal(processor.messages.filter(value => value.diagnostics).length, 2);
  processor.port.onmessage({ data: { debug: false } });
  globalThis.currentTime = 1; processor.process([], [output]);
  assert.equal(processor.messages.filter(value => value.diagnostics).length, 2);
  assert.equal(processor.diagnostics, null);
});

test('render quantum evidence measures actual block lengths and resets with Debug without changing output', () => {
  const processor = new Processor();
  globalThis.currentTime = 0;
  const render = frames => {
    const output = [new Float32Array(frames), new Float32Array(frames)];
    processor.process([], [output]);
    assert.ok(output.every(channel => channel.every(value => value === 0)));
  };
  render(256); assert.equal(processor.diagnostics, null);
  processor.port.onmessage({ data: { debug: true, diagnosticRevision: 1 } });
  for (const frames of [128, 256, 64, 128]) render(frames);
  processor.report();
  const stats = processor.messages.filter(value => value.diagnostics).at(-1).diagnostics;
  assert.equal(stats.processCalls, 4); assert.equal(stats.renderFrames, 576);
  assert.equal(stats.renderQuantumFrames, 128); assert.equal(stats.renderQuantumMinFrames, 64); assert.equal(stats.renderQuantumMaxFrames, 256);
  processor.port.onmessage({ data: { debug: false } }); render(512);
  processor.port.onmessage({ data: { debug: true, diagnosticRevision: 2 } }); render(128); processor.report();
  const fresh = processor.messages.filter(value => value.diagnostics).at(-1).diagnostics;
  assert.equal(fresh.processCalls, 1); assert.equal(fresh.renderQuantumMinFrames, 128); assert.equal(fresh.renderQuantumMaxFrames, 128);
});

test('worklet source-fit evidence uses render-context ages and a replacement epoch cannot retain the previous fit', () => {
  const processor = new Processor(), post = data => processor.port.onmessage({ data });
  post({ calibration: { rate: 48000, outputRate: 48000, delayMs: new SoxrRuntime().filterDelay(48000, 48000) } });
  post({ debug: true, diagnosticRevision: 1 });
  const packet = (epoch, ms) => ({ type: 6, mode: 'airplay-mirror', epoch, generation: 1, rate: 48000, channels: 1,
    flags: 0, sequence: ms / 1000, presentationMs: 1000000 + ms, decodeTimestampUs: ms * 1000, pcm: new Int16Array(960).buffer });
  try {
    for (let ms = 0; ms <= 31000; ms += 1000) { globalThis.currentTime = ms / 1000; post(packet(1, ms)); }
    globalThis.currentTime = 31.1;
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]); processor.report();
    const fitted = processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream6;
    assert.equal(fitted.sourceClockFitStatus, 'tracking'); assert.equal(fitted.sourceClockFitRejectReason, 'none');
    assert.equal(fitted.sourceClockPoints, 32); assert.equal(fitted.sourceClockSpanMs, 31000);
    assert.ok(Math.abs(fitted.sourceClockAcceptedFitAgeMs - (100 + 128 / 48)) < 1e-6);
    globalThis.currentTime = 32; post(packet(2, 32000)); post(packet(1, 33000)); processor.report();
    const replaced = processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream6;
    assert.equal(replaced.epoch, 2); assert.equal(replaced.sourceClockFitStatus, 'acquiring');
    assert.equal(replaced.sourceClockFitRejectReason, 'insufficient-span'); assert.equal(replaced.sourceClockPoints, 1);
    assert.equal(Object.hasOwn(replaced, 'sourceClockAcceptedFitAgeMs'), false);
    post({ debug: false }); assert.equal(processor.timelines.get(6).sourceClock.snapshot(32000), null);
  } finally { post({ dispose: true }); }
});

test('decoder diagnostics count actual signed PCM samples only while enabled', async () => {
  const decoder = createAirPlayAudioDecoder({ onPcm() {} });
  const config = { codec: 'pcm', sampleRate: 48000, channels: 2, bitDepth: 16, littleEndian: true };
  const fields = { type: 0, mode: 'carplay', epoch: 7, rate: 48000, channels: 2, flags: 0, sequence: 0 };
  try {
    await decoder.configure({ ...fields, config }); assert.equal(decoder.stats(), null);
    decoder.debug(true);
    await decoder.decode({ ...fields, payload: new Int16Array([-32768, 0, 16384, 0]).buffer });
    const stats = decoder.stats();
    assert.equal(stats.frames, 2); assert.equal(stats.nonzero, 2); assert.equal(stats.peak, 1);
    assert.equal(stats.stream0.backend, 'pcm'); assert.equal(stats.stream0.epoch, 7);
    decoder.debug(false); assert.equal(decoder.stats(), null);
    decoder.debug(true); assert.equal(decoder.stats().frames, 0);
    assert.equal(await decoder.configure({ ...fields, config: undefined }), false);
    assert.doesNotThrow(() => decoder.debug(true), 'failed configurations cannot break enabling diagnostics');
  } finally { decoder.dispose(); }
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const settleRecovery = () => new Promise(resolve => setTimeout(resolve, 120));
function browserHarness() {
  const previous = { AudioContext: globalThis.AudioContext, AudioWorkletNode: globalThis.AudioWorkletNode };
  const nodes = [], contexts = [], requests = [];
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() { this.messages = []; this.port = { postMessage: value => {
      this.messages.push(value); if (value.prepare) queueMicrotask(() => this.port.onmessage?.({ data: { prepared: value.prepare.id } }));
    } }; nodes.push(this); }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  };
  const audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'test-session' }),
    fetchPhone: async (_, { signal }) => {
      let controller; const body = new ReadableStream({ start(value) { controller = value; } });
      requests.push({ controller, signal }); return { ok: true, body };
    } });
  function pcm(values) {
    const bytes = new Uint8Array(28 + values.length * 2), view = new DataView(bytes.buffer);
    view.setUint32(0, bytes.length - 4); bytes[4] = 2; bytes[6] = 1;
    view.setUint32(8, 48000); view.setFloat64(20, NaN);
    values.forEach((value, index) => view.setInt16(28 + index * 2, value, true));
    requests.at(-1).controller.enqueue(bytes);
  }
  return { audio, nodes, contexts, requests, pcm, done() { audio.dispose(); Object.assign(globalThis, previous); } };
}

test('live render statistics are read only for Debug and preserve optional API failure without changing playback', async () => {
  const h = browserHarness(); let reads = 0;
  try {
    await h.audio.activate();
    const context = h.contexts[0];
    Object.defineProperty(context, 'playbackStats', { configurable: true, get() {
      reads++; return { underrunEvents: 3, underrunDuration: .012345678, totalDuration: 10.25 };
    } });
    h.audio.stats(); assert.equal(reads, 0);
    h.audio.status({ debug: true });
    const debug = h.audio.stats().debug;
    assert.equal(debug.renderStatsState, 'available'); assert.equal(debug.renderUnderrunEvents, 3);
    assert.ok(Math.abs(debug.renderUnderrunDurationMs - 12.345678) < 1e-12); assert.equal(debug.renderTotalDurationMs, 10250);
    const [, detail] = browserDiagnosticEvents({ audio: h.audio.stats() }, false, true);
    assert.equal(detail.v.renderUnderrunDurationMs, 12.345678);
    assert.equal(detail.v.renderUnderrunEvents, 3);
    Object.defineProperty(context, 'playbackStats', { get() { throw new Error('private device error'); } });
    assert.equal(h.audio.stats().debug.renderStatsState, 'failed');
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'renderUnderrunEvents'), false);
    assert.equal(context.state, 'running');
    h.audio.status({ debug: false }); const before = reads; h.audio.stats(); assert.equal(reads, before);
  } finally { h.done(); }
});

test('status.debug toggles PCM/context/render diagnostics without reconnecting or retaining old measurements', async () => {
  const h = browserHarness();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    assert.equal(h.audio.stats().debug, undefined);
    const request = h.requests.at(-1);
    h.audio.status({ debug: true }); h.pcm([0, -32768, 16384]); await tick();
    const generation = h.nodes[0].messages.findLast(message => message.debug === true).generation;
    h.nodes[0].port.onmessage({ data: { diagnosticRevision: 1, playbackGeneration: generation,
      diagnostics: { renderFrames: 128, renderNonzero: 64, renderPeak: 0.5, renderTimeMs: 0 } } });
    const stats = h.audio.stats().debug;
    assert.equal(stats.pcmFrames, 3); assert.equal(stats.pcmNonzero, 2); assert.equal(stats.pcmPeak, 1);
    assert.equal(stats.contextState, 'running'); assert.equal(stats.contextRate, 48000);
    assert.equal(stats.deviceClockFitStatus, 'acquiring'); assert.equal(stats.deviceClockFitRejectReason, 'none');
    assert.equal(stats.deviceClockFitRejected, 0); assert.equal(Object.hasOwn(stats, 'deviceClockAcceptedFitAgeMs'), false);
    assert.equal(Object.hasOwn(stats, 'deviceClockFitDispersionMs'), false, 'no immature MAD is substituted for a fit');
    assert.equal(stats.renderFrames, 128); assert.ok(Number.isFinite(stats.clockBase));
    h.audio.status({ debug: false }); assert.equal(h.audio.stats().debug, undefined);
    assert.deepEqual(h.nodes[0].messages.at(-1), { debug: false, diagnosticRevision: 2, generation });
    assert.equal(h.requests.at(-1), request, 'a debug switch must not renegotiate the audio stream');
    h.nodes[0].port.onmessage({ data: { diagnostics: { renderFrames: 999 } } });
    h.audio.status({ debug: true }); assert.equal(h.audio.stats().debug.renderFrames, undefined);
    h.nodes[0].port.onmessage({ data: { diagnosticRevision: 1, playbackGeneration: generation, diagnostics: { renderFrames: 999 } } });
    assert.equal(h.audio.stats().debug.renderFrames, undefined, 'a delayed report from the retired capture stays retired');
    assert.equal(h.audio.stats().debug.pcmFrames, 0);
  } finally { h.done(); }
});

test('reset clears retained worklet evidence and rejects delayed reports from the retired playback generation', async () => {
  const h = browserHarness();
  const deadline = { lastSourceDeadlineDeltaUpperMs: 300.000001, lastSourceDeadlineUncertaintyMs: 8.164241,
    lastSourceDeadlineAgeMs: 2.666667, lastSourceDeadlineLimitMs: 300 };
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    h.audio.debug(true);
    const node = h.nodes[0], debug = node.messages.findLast(message => message.debug === true);
    const report = (generation, stream) => node.port.onmessage({ data: { diagnosticRevision: debug.diagnosticRevision,
      playbackGeneration: generation, diagnostics: { renderFrames: 128, stream0: stream } } });
    report(debug.generation, { generation: debug.generation, epoch: 7, ...deadline });
    assert.deepEqual(h.audio.stats().debug.stream0, { generation: debug.generation, epoch: 7, ...deadline });
    const [, event] = browserDiagnosticEvents({ audio: h.audio.stats() }, false, true, 'capture');
    for (const [key, value] of Object.entries(deadline)) assert.equal(event.v[`stream0.${key}`], value);
    assert.equal(Object.keys(browserDiagnosticEvents({ audio: h.audio.stats() }, false)[0].v)
      .some(key => key.includes('lastSourceDeadline')), false);
    h.audio.reset();
    const reset = node.messages.findLast(message => message.reset);
    assert.notEqual(reset.generation, debug.generation);
    assert.equal(h.audio.stats().debug.stream0, undefined);
    assert.equal(h.audio.stats().debug.renderReportAgeMs, null);
    report(debug.generation, { generation: debug.generation, epoch: 7, ...deadline });
    assert.equal(h.audio.stats().debug.stream0, undefined, 'same Debug revision cannot revive the retired generation');
    node.port.onmessage({ data: { diagnosticRevision: debug.diagnosticRevision, diagnostics: { renderFrames: 999 } } });
    assert.equal(h.audio.stats().debug.renderFrames, undefined, 'a report with unknown playback generation stays unknown');
    report(reset.generation, { generation: reset.generation, epoch: 8, state: 'priming' });
    assert.equal(h.audio.stats().debug.stream0.epoch, 8);
    assert.equal(Object.hasOwn(h.audio.stats().debug.stream0, 'lastSourceDeadlineDeltaUpperMs'), false);
    report(reset.generation, { generation: reset.generation, epoch: 9, ...deadline });
    assert.equal(h.audio.stats().debug.stream0.epoch, 9);
    report(reset.generation, { generation: reset.generation, epoch: 10, state: 'priming' });
    assert.equal(h.audio.stats().debug.stream0.epoch, 10);
    assert.equal(Object.hasOwn(h.audio.stats().debug.stream0, 'lastSourceDeadlineAgeMs'), false,
      'a replacement epoch report cannot merge the preceding epoch\'s retained trigger');
    h.audio.debug(false); report(reset.generation, { epoch: 10, ...deadline });
    assert.equal(h.audio.stats().debug, undefined);
    h.audio.debug(true);
    assert.equal(h.audio.stats().debug.stream0, undefined);
  } finally { h.done(); }
});

test('worklet diagnostic envelopes follow reset and packet generations independently of Debug revision', () => {
  const processor = new Processor(), post = data => processor.port.onmessage({ data });
  try {
    post({ debug: true, diagnosticRevision: 4, generation: 7 }); processor.report();
    let report = processor.messages.findLast(message => message.diagnostics);
    assert.equal(report.diagnosticRevision, 4); assert.equal(report.playbackGeneration, 7);
    post({ reset: true, generation: 8 }); processor.report();
    report = processor.messages.findLast(message => message.diagnostics);
    assert.equal(report.diagnosticRevision, 4); assert.equal(report.playbackGeneration, 8);
    post({ type: 0, mode: 'carplay', epoch: 10, generation: 9, rate: 48000, channels: 1,
      flags: 0, sequence: 1, sourceTime: 0, pcm: new Int16Array(128).buffer }); processor.report();
    assert.equal(processor.messages.findLast(message => message.diagnostics).playbackGeneration, 9);
    post({ debug: false, diagnosticRevision: 5, generation: 9 });
    const count = processor.messages.filter(message => message.diagnostics).length;
    processor.report(); assert.equal(processor.messages.filter(message => message.diagnostics).length, count);
  } finally { post({ dispose: true }); }
});

test('browser device MAD reaches Debug telemetry only after a fit in that capture interval', async () => {
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let at = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => at, timeOrigin: 0 } });
  const h = browserHarness();
  try {
    await h.audio.activate(); await tick();
    const context = h.contexts[0];
    context.getOutputTimestamp = () => ({ contextTime: (at - 200) / 1000, performanceTime: at });
    const sample = value => { at = value; context.currentTime = at / 1000; h.audio.clock(null); };
    h.audio.debug(true);
    for (let value = 1000; value <= 10000; value += 100) sample(value);
    const fitted = h.audio.stats();
    assert.equal(fitted.debug.deviceClockFitStatus, 'tracking');
    assert.equal(fitted.debug.deviceClockUncertaintyMs, 0); assert.equal(fitted.debug.deviceClockFitDispersionMs, 0);
    const detail = browserDiagnosticEvents({ audio: fitted }, false, true).find(event => event.k === 'audio-diag');
    assert.equal(detail.v.deviceClockFitDispersionMs, 0);
    h.audio.debug(false); assert.equal(h.audio.stats().debug, undefined);
    h.audio.debug(true);
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'deviceClockFitDispersionMs'), false,
      'enabling Debug cannot label an older fit as newly observed noise');
    sample(10100);
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'deviceClockFitDispersionMs'), false);
    sample(10500); assert.equal(h.audio.stats().debug.deviceClockFitDispersionMs, 0);
    h.audio.reset();
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'deviceClockFitDispersionMs'), false,
      'a retired timeline cannot lend its last fit noise to its replacement');
  } finally {
    h.done(); Object.defineProperty(globalThis, 'performance', previousPerformance);
  }
});

test('processor failures recreate the node and stream with fresh credit, reject retired callbacks and stop after two retries', async () => {
  const h = browserHarness();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    h.pcm([1, 2]); await tick();
    const first = h.nodes[0], staleMessage = first.port.onmessage, staleFailure = first.onprocessorerror;
    const old = first.messages.find(message => message.pcm), oldRequest = h.requests.at(-1);
    first.onprocessorerror();
    assert.equal(oldRequest.signal.aborted, true); assert.equal(first.connected, false);
    assert.equal(h.audio.stats().processorFailed, true); assert.equal(h.audio.stats().queuedBytes, 0);
    await settleRecovery(); await tick();
    assert.equal(h.nodes.length, 2); assert.equal(h.contexts.length, 1); assert.equal(h.audio.stats().recoveries, 1);
    h.pcm([3, 4]); await tick();
    const current = h.nodes[1].messages.find(message => message.pcm);
    assert.notEqual(current.generation, old.generation); assert.equal(h.audio.stats().queuedBytes, 4);
    staleMessage({ data: { consumed: 4, generation: current.generation } }); staleFailure();
    assert.equal(h.audio.stats().queuedBytes, 4); assert.equal(h.audio.stats().processorErrors, 1);
    h.nodes[1].onprocessorerror(); await settleRecovery(); await tick();
    h.nodes[2].onprocessorerror(); await settleRecovery();
    assert.equal(h.nodes.length, 3); assert.equal(h.audio.stats().recoveries, 2);
    assert.equal(h.audio.stats().processorErrors, 3); assert.equal(h.audio.stats().processorFailed, true);
    assert.match(h.audio.stats().error, /repeatedly/);
  } finally { h.done(); }
});

test('disposal cancels a pending processor restart', async () => {
  const h = browserHarness();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    h.nodes[0].onprocessorerror(); h.audio.dispose();
    await settleRecovery(); assert.equal(h.nodes.length, 1);
  } finally { h.done(); }
});

test('re-enabling audio after a cancelled processor recovery recreates playback', async () => {
  const h = browserHarness();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    h.nodes[0].onprocessorerror(); h.audio.status({ audio: false });
    await settleRecovery(); assert.equal(h.nodes.length, 1);
    h.audio.status({ audio: true }); await tick();
    assert.equal(h.nodes.length, 2); assert.equal(h.audio.stats().processorFailed, false);
    h.pcm([42]); await tick(); assert.equal(h.audio.stats().queuedBytes, 2);
  } finally { h.done(); }
});
