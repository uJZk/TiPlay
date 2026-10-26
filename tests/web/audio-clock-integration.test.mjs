// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';
import { createAudioReferenceTimeline } from '../../site/play/audio-output-clock.js';

// Browser scheduling and clocks are controlled; the production worklet and DSP
// are loaded unchanged and exchange real structured-cloned, transferred records.
const immediate = () => new Promise(resolve => setImmediate(resolve));
let Processor, constructingPort;
const signal = frame => 0.31 * Math.sin(frame * 2 * Math.PI * 997 / 48000)
  + 0.13 * Math.cos(frame * 2 * Math.PI * 137 / 48000)
  + 0.07 * Math.sin(frame * 2 * Math.PI * 4193 / 48000);

function pcmRecord(first, frames, presentationMs, sequence, epoch = 7) {
  const bytes = new Uint8Array(28 + frames * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4); bytes[4] = 2; bytes[6] = 1;
  view.setUint32(8, 48000); view.setUint32(12, sequence); view.setUint32(16, epoch);
  view.setFloat64(20, presentationMs);
  for (let i = 0; i < frames; i++) view.setInt16(28 + i * 2, Math.round(signal(first + i) * 32767), true);
  return bytes;
}

async function harness({ devicePpm = 90, outputDelayMs = 80 } = {}) {
  const names = ['performance', 'AudioContext', 'AudioWorkletNode', 'AudioWorkletProcessor',
    'registerProcessor', 'sampleRate', 'currentTime', 'currentFrame', 'setTimeout', 'clearTimeout'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const epoch = 1_800_000_000_000, sourceOrigin = 600_000_000;
  let localMs = 10000, context, timerId = 0, inputFrame = 0, sequence = 0;
  const timers = new Map(), mailbox = [], nodes = [], requests = [], postedPcm = [], feedback = [], references = [], referenceConsumers = [];
  const audioReferences = createAudioReferenceTimeline();
  const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  define('performance', { timeOrigin: epoch, now: () => localMs });
  define('setTimeout', (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: localMs + delay }); return id; });
  define('clearTimeout', id => timers.delete(id));
  define('sampleRate', 48000);
  Object.defineProperty(globalThis, 'currentTime', { configurable: true, get: () => context?.currentTime ?? 10 });
  Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => context?.frames ?? 480000 });
  define('AudioWorkletProcessor', class { constructor() { this.port = constructingPort; } });
  define('registerProcessor', (name, implementation) => { assert.equal(name, 'tiplay-audio'); Processor = implementation; });
  if (!Processor) await import('../../site/play/audio-worklet.js?clock-integration');
  function ports() {
    const main = { onmessage: null }, worklet = { onmessage: null };
    main.postMessage = (data, transfer = []) => {
      if (data.pcm?.byteLength) postedPcm.push({ presentationMs: data.presentationMs, sourceTime: data.sourceTime,
        generation: data.generation, sequence: data.sequence, epoch: data.epoch, bytes: data.pcm.byteLength });
      const cloned = structuredClone(data, { transfer });
      mailbox.push(() => worklet.onmessage?.({ data: cloned }));
    };
    worklet.postMessage = data => {
      const cloned = structuredClone(data);
      if (cloned.playout) feedback.push(cloned.playout);
      mailbox.push(() => main.onmessage?.({ data: cloned }));
    };
    return { main, worklet };
  }
  define('AudioContext', class {
    constructor() {
      context = this; this.state = 'suspended'; this.sampleRate = 48000; this.frames = 480000;
      this.baseLatency = 0.012; this.outputLatency = 0.08; this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    get currentTime() { return this.frames / this.sampleRate; }
    getOutputTimestamp() { return { contextTime: this.currentTime - outputDelayMs / 1000, performanceTime: localMs }; }
    async resume() { this.state = 'running'; this.onstatechange?.(); }
    async close() { this.state = 'closed'; }
    suspend() { this.state = 'suspended'; this.onstatechange?.(); }
  });
  define('AudioWorkletNode', class {
    constructor() {
      const pair = ports(); this.port = pair.main; constructingPort = pair.worklet;
      this.processor = new Processor(); nodes.push(this);
    }
    connect() {}
    disconnect() { this.disconnected = true; }
  });
  function drain() {
    for (let guard = 0; mailbox.length; guard++) {
      assert.ok(guard < 10000, 'message delivery must settle'); mailbox.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 4; i++) { await immediate(); drain(); } }
  function runTimers() {
    for (const [id, timer] of [...timers]) if (timer.at <= localMs) { timers.delete(id); timer.callback(); }
  }
  const audio = createBrowserAudio({
    credentials: () => ({ code: 'fixture', session: 'fixture' }),
    onAudioReference: reference => {
      references.push(reference); audioReferences.update(reference);
      for (const consume of referenceConsumers) consume(reference);
    },
    fetchPhone: async (_route, { signal }) => {
      const request = { closed: false, signal };
      request.body = new ReadableStream({ start(controller) { request.controller = controller; } });
      signal.addEventListener('abort', () => { if (!request.closed) { request.closed = true; request.controller.error(new DOMException('Aborted', 'AbortError')); } }, { once: true });
      requests.push(request); return { ok: true, body: request.body };
    },
  });
  const calibration = (generation = 3, rate = 1) => ({ version: 2, generation,
    serverOriginMs: sourceOrigin, localOriginMs: epoch + 10000,
    rate, offset: epoch + 10000 - sourceOrigin, at: epoch + localMs, rtt: 2,
    state: 'tracking', uncertaintyMs: 1, offsetConfidence: 0.9, rateConfidence: 0.9 });
  let activating = true;
  const activation = audio.activate().finally(() => { activating = false; });
  for (let turn = 0; activating; turn++) { assert.ok(turn < 100, 'worklet preparation must settle'); await settle(); }
  await activation; await settle();
  audio.clock(calibration());
  audio.attach(new AbortController().signal, { audio: true }); await settle();
  async function feed(untilFrame, { epoch: streamEpoch = 7, restart = false } = {}) {
    if (restart) { inputFrame = 0; sequence = 0; }
    const request = requests.at(-1);
    while (inputFrame < untilFrame) {
      const frames = 960;
      const bytes = pcmRecord(inputFrame, frames, sourceOrigin + outputDelayMs + inputFrame / 48, sequence++, streamEpoch);
      // Exercise the production framing path across network chunk boundaries.
      request.controller.enqueue(bytes.subarray(0, 23)); request.controller.enqueue(bytes.subarray(23));
      inputFrame += frames;
    }
    await settle();
  }
  function quantum(deliver = true) {
    if (deliver) drain(); const node = nodes.at(-1), output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(node.processor.process([], [output]), true);
    context.frames += 128; localMs += 128000 / (48000 * (1 + devicePpm / 1e6));
    if (deliver) { drain(); runTimers(); } return output[0];
  }
  async function playing() {
    await feed(48000);
    // A native output sample must first enter the Worklet's proved run. Warm
    // beyond the 80ms device pipeline and the following control/feedback turn.
    for (let i = 0; i < 60; i++) quantum();
  }
  return { audio, nodes, requests, postedPcm, feedback, references, audioReferences, calibration,
    get context() { return context; }, get now() { return epoch + localMs; }, get localMs() { return localMs; },
    sourceOrigin, outputDelayMs, feed, quantum, playing, settle, drain,
    observeReference(consume) { referenceConsumers.push(consume); },
    advanceWall(ms) { localMs += ms; runTimers(); },
    async close() {
      audio.dispose(); await settle();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
    },
  };
}

test('transport and actual NetEq keep audio independent of clock estimates', async () => {
  const h = await harness();
  try {
    await h.playing();
    const stream = h.nodes[0].processor.streams.get(0), engine = stream.engine;
    for (const generation of [4, 9, 2]) {
      h.audio.clock({ ...h.calibration(generation), serverOriginMs: -1e9, rate: .98 });
      for (let i = 0; i < 30; i++) h.quantum();
      assert.equal(h.nodes[0].processor.streams.get(0).engine, engine);
    }
    assert.ok(h.references.some(value => value?.playoutState === 'playing' || value?.state === 'untimed'));
    assert.ok(h.references.every(value => value?.audibleTimeMs == null));
    assert.ok(h.postedPcm.every(packet => packet.sourceTime === undefined));
  } finally { await h.close(); }
});

test('real receiver credits NetEq consumption and rejects stale port generations', async () => {
  const h = await harness();
  try {
    await h.playing();
    const count = h.references.length, old = h.nodes[0];
    h.audio.status({ audio: false }); await h.settle();
    old.port.onmessage?.({ data: { playout: { generation: -1, state: 'playing' } } });
    assert.equal(h.references.length, count + 1); // Explicit invalidation, never old playback.
    h.audio.status({ audio: true }); await h.settle();
    await h.feed(48000, { epoch: 8, restart: true });
    for (let i = 0; i < 80; i++) h.quantum();
    assert.equal(h.nodes.at(-1).processor.streams.get(0).epoch, 8);
  } finally { await h.close(); }
});
