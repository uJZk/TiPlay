// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';
import { browserDiagnosticEvents } from '../../site/play/browser-diagnostics.js';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

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
    assert.equal(stats.renderFrames, 128);
    assert.equal(stats.clockBase, undefined, 'a getter-derived wall-clock epoch is not playback evidence');
    assert.equal(stats.renderAgeMs, null, 'getter disagreement cannot establish render age');
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
    lastSourceDeadlineAgeMs: 2.666667, lastSourceDeadlineLimitMs: 300,
    lastRetiredSourceDeadlineEpoch: 6, lastRetiredSourceDeadlineGeneration: 3,
    lastRetiredSourceDeadlineDeltaUpperMs: 301.000001, lastRetiredSourceDeadlineUncertaintyMs: 8.164241,
    lastRetiredSourceDeadlineAgeMs: 2.666667, lastRetiredSourceDeadlineLimitMs: 300,
    retiredSourceDeadlineRejectedFrames: 240 };
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

test('short observed context suspensions survive sparse snapshots and Debug reset without affecting the audio state', async () => {
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let at = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => at, timeOrigin: 0 } });
  const h = browserHarness();
  try {
    await h.audio.activate(); await tick();
    const context = h.contexts[0];
    h.audio.debug(true);
    const before = h.audio.stats().debug.contextObservedStateChanges;
    at = 1000; context.state = 'suspended'; context.onstatechange();
    at = 1300;
    assert.equal(h.audio.stats().debug.contextObservedNonRunningMs, 300);
    at = 1600; context.state = 'running'; context.onstatechange();
    at = 5000;
    const debug = h.audio.stats().debug;
    assert.equal(debug.contextObservedStateChanges, before + 2);
    assert.equal(debug.contextObservedNonRunningMs, 600, 'a pause wholly between ordinary snapshots is retained');
    assert.equal(h.audio.stats().debug.contextObservedNonRunningMs, 600, 'reads cannot count an interval twice');
    const [summary, detail] = browserDiagnosticEvents({ audio: h.audio.stats() }, false, true);
    assert.equal(detail.v.contextObservedNonRunningMs, 600);
    assert.equal(Object.keys(summary.v).some(key => key.includes('contextObserved')), false);
    h.audio.debug(false);
    at = 6000; context.state = 'suspended'; context.onstatechange();
    at = 6500; context.state = 'running'; context.onstatechange();
    h.audio.debug(true);
    assert.equal(h.audio.stats().debug.contextObservedStateChanges, 0);
    assert.equal(h.audio.stats().debug.contextObservedNonRunningMs, 0);
    assert.equal(context.state, 'running');
  } finally {
    h.done(); Object.defineProperty(globalThis, 'performance', previousPerformance);
  }
});

test('browser device MAD reaches Debug telemetry only after a fit in that capture interval', async () => {
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let at = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => at, timeOrigin: 0 } });
  const h = browserHarness();
  try {
    await h.audio.activate(); await tick();
    const context = h.contexts[0], installed = h.nodes[0];
    context.getOutputTimestamp = () => ({ contextTime: (at - 200) / 1000, performanceTime: at });
    const sample = value => {
      at = value; context.currentTime = at / 1000; h.audio.clock(null);
      const message = installed.messages.at(-1);
      if (message.renderProbe) installed.port.onmessage({ data: { renderProbe: {
        token: message.renderProbe, generation: 0, startFrame: 0,
        endFrame: value * 48 + 128, renderQuantumFrames: 128,
      } } });
    };
    h.audio.debug(true);
    for (let value = 1000; value <= 10000; value += 100) sample(value);
    const fitted = h.audio.stats();
    assert.equal(fitted.debug.deviceClockFitStatus, 'tracking');
    assert.equal(fitted.debug.deviceClockSource, 'native', 'a fresh native fit takes priority over render progress');
    assert.equal(fitted.debug.deviceClockUncertaintyMs, 0);
    assert.equal(fitted.debug.deviceClockFitDispersionMs, 0);
    assert.equal(fitted.debug.outputTimestampFitUncertaintyMs, 0, 'native phase noise stays separate from render quantization');
    assert.equal(fitted.debug.outputTimestampFitStatus, 'tracking');
    assert.ok(Number.isSafeInteger(fitted.debug.outputTimestampFitGeneration));
    const detail = browserDiagnosticEvents({ audio: fitted }, false, true).find(event => event.k === 'audio-diag');
    assert.equal(detail.v.deviceClockFitDispersionMs, 0);
    assert.equal(detail.v.outputTimestampFitUncertaintyMs, 0);
    assert.equal(detail.v.outputTimestampFitStatus, 'tracking');
    assert.equal(detail.v.outputTimestampFitGeneration, fitted.debug.outputTimestampFitGeneration);
    h.audio.debug(false); assert.equal(h.audio.stats().debug, undefined);
    h.audio.debug(true);
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'deviceClockFitDispersionMs'), false,
      'enabling Debug cannot label an older fit as newly observed noise');
    sample(10050); // Before the next fit cadence; accepted native evidence starts after the first frame proof.
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'deviceClockFitDispersionMs'), false);
    sample(10500); assert.equal(h.audio.stats().debug.deviceClockFitDispersionMs, 0);
    h.audio.reset();
    assert.equal(Object.hasOwn(h.audio.stats().debug, 'deviceClockFitDispersionMs'), false,
      'a retired timeline cannot lend its last fit noise to its replacement');
  } finally {
    h.done(); Object.defineProperty(globalThis, 'performance', previousPerformance);
  }
});

test('Debug reports render proof state independently of a selected native fit', async () => {
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let at = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => at, timeOrigin: 0 } });
  const h = browserHarness();
  try {
    await h.audio.activate(); await tick();
    const context = h.contexts[0], installed = h.nodes[0];
    context.getOutputTimestamp = () => ({ contextTime: (at - 200) / 1000, performanceTime: at });
    h.audio.debug(true);
    const sample = (value, generation = 0, offset = 0) => {
      at = value; context.currentTime = (at + offset) / 1000; h.audio.clock(null);
      const message = installed.messages.at(-1);
      if (message.renderProbe) installed.port.onmessage({ data: { renderProbe: {
        token: message.renderProbe, generation, startFrame: generation ? 10120 * 48 : 0,
        endFrame: Math.round((at + offset) * 48) + 128, renderQuantumFrames: 128,
      } } });
    };
    for (let value = 1000; value <= 10000; value += 100) sample(value);
    const before = h.audio.stats().debug;
    assert.equal(before.deviceClockSource, 'native');
    assert.equal(before.renderClockDomainGeneration, 0);
    assert.ok(before.renderClockProbeAccepted > 20);
    sample(10100, 1, 20);
    const changed = h.audio.stats().debug;
    assert.equal(changed.deviceClockSource, 'holdover', 'a new actual sample domain retires the old fit evidence');
    assert.equal(changed.outputTimestampFitGeneration, before.outputTimestampFitGeneration + 1);
    assert.equal(changed.deviceClockGeneration, before.deviceClockGeneration + 1);
    assert.equal(changed.deviceClockReason, 'sample-domain');
    assert.equal(changed.renderClockDomainGeneration, 1);
    assert.equal(changed.renderClockDomainChanges, 1);
    assert.equal(changed.renderClockProbeReason, 'accepted', 'the actual frontier is already measured in the new domain');
    sample(10200, 1, 20);
    const retained = h.audio.stats();
    assert.equal(retained.debug.renderClockProbeState, 'idle');
    assert.equal(Object.hasOwn(retained.debug, 'renderClockProbeAgeMs'), false);
    const [summary, detail] = browserDiagnosticEvents({ audio: retained }, false, true);
    assert.equal(detail.v.renderClockDomainGeneration, 1);
    assert.equal(detail.v.renderClockProbeReason, 'accepted');
    assert.equal(Object.keys(summary.v).some(key => key.includes('renderClockProbe')), false);
    h.audio.debug(false); h.audio.debug(true);
    assert.equal(h.audio.stats().debug.renderClockProbeAccepted, 0);
    assert.equal(h.audio.stats().debug.renderClockProbeRejected, 0);
    h.audio.reset();
    assert.equal(h.audio.stats().debug.renderClockDomainGeneration, null);
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
