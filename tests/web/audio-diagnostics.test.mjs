// SPDX-License-Identifier: GPL-3.0-only
import { loadTestResampler } from './fixtures/audio-resampler-module.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';
import { PcmTimeline } from '../../site/play/pcm-timeline.js';
import { constantDelay } from '../../site/play/delay-plan.js';
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
    constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; nodes.push(this); }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  };
  const audio = createBrowserAudio({ loadResampler: loadTestResampler, credentials: () => ({ code: '1234', session: 'test-session' }),
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

test('status.debug toggles PCM/context/render diagnostics without reconnecting or retaining old measurements', async () => {
  const h = browserHarness();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    assert.equal(h.audio.stats().debug, undefined);
    const request = h.requests.at(-1);
    h.audio.status({ debug: true }); h.pcm([0, -32768, 16384]); await tick();
    h.nodes[0].port.onmessage({ data: { diagnosticRevision: 1, diagnostics: { renderFrames: 128, renderNonzero: 64, renderPeak: 0.5, renderTimeMs: 0 } } });
    const stats = h.audio.stats().debug;
    assert.equal(stats.pcmFrames, 3); assert.equal(stats.pcmNonzero, 2); assert.equal(stats.pcmPeak, 1);
    assert.equal(stats.contextState, 'running'); assert.equal(stats.contextRate, 48000);
    assert.equal(stats.renderFrames, 128); assert.ok(Number.isFinite(stats.clockBase));
    h.audio.status({ debug: false }); assert.equal(h.audio.stats().debug, undefined);
    assert.deepEqual(h.nodes[0].messages.at(-1), { debug: false, diagnosticRevision: 2 });
    assert.equal(h.requests.at(-1), request, 'a debug switch must not renegotiate the audio stream');
    h.nodes[0].port.onmessage({ data: { diagnostics: { renderFrames: 999 } } });
    h.audio.status({ debug: true }); assert.equal(h.audio.stats().debug.renderFrames, undefined);
    h.nodes[0].port.onmessage({ data: { diagnosticRevision: 1, diagnostics: { renderFrames: 999 } } });
    assert.equal(h.audio.stats().debug.renderFrames, undefined, 'a delayed report from the retired capture stays retired');
    assert.equal(h.audio.stats().debug.pcmFrames, 0);
  } finally { h.done(); }
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
