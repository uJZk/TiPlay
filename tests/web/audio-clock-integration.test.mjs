// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudio } from '../../site/play/audio.js';
import { createAudioReferenceTimeline } from '../../site/play/audio-output-clock.js';
import { createTimedFrames } from '../../site/play/media-timing.js';
import { constantDelay } from '../../site/play/delay-plan.js';

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
    'registerProcessor', 'sampleRate', 'currentTime', 'setTimeout', 'clearTimeout'];
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
  async function playing() { await feed(48000); for (let i = 0; i < 30; i++) quantum(); }
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

test('real DSP stays continuous through transient native timestamp faults, slow reads and measurement restarts', async () => {
  const h = await harness({ devicePpm: -4000 });
  try {
    await h.playing();
    const processor = h.nodes[0].processor, player = processor.timelines.get(0), backend = player.backend;
    const nativeTimestamp = h.context.getOutputTimestamp.bind(h.context);
    let fault = null, reads = 0, minimumEnergy = Infinity, maximumStep = 0, previous = null;
    const observe = block => {
      minimumEnergy = Math.min(minimumEnergy, block.reduce((sum, value) => sum + value ** 2, 0));
      for (const sample of block) {
        if (previous !== null) maximumStep = Math.max(maximumStep, Math.abs(sample - previous));
        previous = sample;
      }
    };
    h.context.getOutputTimestamp = () => {
      reads++;
      if (fault === 'slow') {
        fault = null;
        // Audio keeps rendering while the main thread waits for a native getter.
        for (let i = 0; i < 15; i++) observe(h.quantum(false));
      }
      const timestamp = nativeTimestamp();
      if (fault === 'future') timestamp.performanceTime += 100;
      if (fault === 'backward') { timestamp.contextTime -= .2; timestamp.performanceTime -= 200; }
      return timestamp;
    };
    for (let quantum = 0; quantum < 2400; quantum++) {
      if (quantum % 30 === 0) await h.feed(Math.ceil(((h.localMs - 10000) + 700) * 48));
      fault = quantum >= 300 && quantum < 320 ? 'future' : quantum >= 500 && quantum < 520 ? 'backward' : null;
      if (quantum === 700) { fault = 'slow'; h.audio.clock(h.calibration()); }
      if (quantum === 900) processor.port.onmessage({ data: {
        deviceClock: { generation: 100, rate: processor.deviceClock.rate },
      } });
      observe(h.quantum());
    }
    assert.equal(player.backend, backend, 'rejected measurements and fit generations preserve the actual Soxr filter');
    assert.deepEqual(player.recoveryCounts, {});
    assert.ok(reads > 100);
    assert.ok(minimumEnergy > 3, `dynamic audio keeps every block audible: ${minimumEnergy}`);
    assert.ok(maximumStep < .3, `native measurements cannot introduce waveform discontinuities: ${maximumStep}`);
    assert.ok(h.references.some(reference => reference?.outputMethod === 'timestamp-holdover'));
  } finally { await h.close(); }
});

function videoConsumer(h, initialReference) {
  let draws = 0, timer = 0;
  const frames = createTimedFrames(frame => { draws++; frame.close(); }, { now: () => h.now, schedule: () => ++timer, cancel() {} });
  frames.delay(constantDelay(0)); frames.audio(initialReference);
  h.observeReference(reference => frames.audio(reference));
  return {
    assertIndependent(clockGeneration = 3) {
      const frame = { closed: false, close() { this.closed = true; } };
      frames.present(frame, { mode: 'carplay' }, 1, h.now,
        { sourceTimeMs: initialReference.sourceTimeMs, clockGeneration });
      assert.equal(frame.closed, true, 'the presenter owns and releases the independently available video');
      assert.ok(draws > 0, 'unavailable audio cannot freeze independent video');
      assert.notEqual(frames.stats().audioSyncState, 'video-only');
    },
    close() { frames.reset(); },
  };
}

test('production audio transport and real soxr retain raw anchors through clock refinements with debug off', async () => {
  const h = await harness();
  try {
    await h.feed(48000);
    const firstPacket = h.postedPcm[0], firstTimeline = h.nodes[0].processor.timelines.get(0);
    let minimumEnergy = Infinity, maximumStep = 0, previous = 0, refinements = 0, worstBlock = null;
    for (let quantum = 0; quantum < 1500; quantum++) {
      if (quantum % 30 === 0) await h.feed(Math.ceil(((h.localMs - 10000) + 700) * 48));
      if (quantum && quantum % 300 === 0) {
        h.audio.clock(h.calibration(3, 1 + ++refinements * 0.00002)); h.drain();
      }
      const block = h.quantum();
      if (quantum > 50) {
        const energy = block.reduce((sum, value) => sum + value ** 2, 0);
        if (energy < minimumEnergy) {
          minimumEnergy = energy;
          worstBlock = { quantum, state: firstTimeline.state, reason: firstTimeline.reason,
            phaseErrorMs: firstTimeline.phaseErrorMs, bytes: firstTimeline.bytes, inputFrame: firstTimeline.inputFrame };
        }
        for (const sample of block) { maximumStep = Math.max(maximumStep, Math.abs(sample - previous)); previous = sample; }
      } else previous = block.at(-1);
    }
    const player = h.nodes[0].processor.timelines.get(0), reference = h.references.findLast(value => value?.state === 'playing');
    assert.equal(h.audio.stats().debug, undefined);
    assert.ok(reference, 'audio output references are necessary playback data in Standard mode');
    assert.equal(player, firstTimeline, 'calibrations retain the live stream and its sample counter');
    assert.equal(player.sourceAnchorMs, firstPacket.presentationMs);
    assert.equal(h.nodes[0].processor.clock.localOriginMs, 10000, 'the main-thread boundary removes the large performance epoch once');
    assert.ok(h.nodes[0].processor.contextAnchor.localTimeMs < 20000);
    assert.ok(player.backend.runtime.exports.memory.buffer instanceof ArrayBuffer);
    assert.ok(player.backend.outputFrames > 100000, 'the production JavaScript engine processes actual samples');
    assert.ok(Math.abs(player.slewRatio - 1) > 0.00003, 'production clock refinements reach the variable-rate JavaScript engine');
    assert.ok(minimumEnergy > 3, `dynamic PCM minimum block energy ${minimumEnergy}: ${JSON.stringify(worstBlock)}`);
    assert.ok(maximumStep < 0.3, 'packet boundaries and ratio refinements remain continuous');
    assert.ok(h.postedPcm.every(packet => packet.sourceTime === undefined), 'v2 calibration never rewrites raw packets into epoch-valued sourceTime');
    for (const packet of h.postedPcm) assert.equal(packet.presentationMs, h.sourceOrigin + h.outputDelayMs + packet.sequence * 20);
    assert.equal(reference.clockGeneration, 3);
    assert.ok(Math.abs(reference.outputLatencyMs - h.outputDelayMs) < 1e-6);
    assert.ok(Math.abs(reference.audibleTimeMs - reference.at - h.outputDelayMs) < 0.001,
      'getOutputTimestamp includes device delay once; base/output/filter latency cannot be added again');
  } finally { await h.close(); }
});

test('suspend invalidates the active producer identity and resumes through the real processor', async () => {
  const h = await harness();
  try {
    await h.playing();
    const before = h.references.findLast(value => value?.state === 'playing'); assert.ok(before);
    const video = videoConsumer(h, before);
    h.context.suspend(); h.drain();
    const invalid = h.references.at(-1);
    assert.equal(invalid.mode, before.mode); assert.equal(invalid.epoch, before.epoch);
    assert.equal(invalid.state, 'suspended'); assert.equal(invalid.audibleTimeMs, null);
    assert.equal(h.audioReferences.resolve('carplay', before.sourceTimeMs, 3, h.now).required, true);
    video.assertIndependent();
    h.advanceWall(50); await h.context.resume(); h.drain();
    for (let i = 0; i < 30; i++) h.quantum();
    const resumed = h.references.findLast(value => value?.state === 'playing');
    assert.ok(resumed.at > before.at); assert.equal(resumed.epoch, before.epoch);
    assert.ok(h.nodes[0].processor.timelines.get(0).backend.outputFrames > 0);
    video.close();
  } finally { await h.close(); }
});

test('EOF and processor failure preserve invalid audio identity while replacement rejects retired-port feedback', async () => {
  for (const failure of ['eof', 'processor']) {
    const h = await harness();
    try {
      await h.playing();
      const previousNode = h.nodes.at(-1), staleCallback = previousNode.port.onmessage;
      const before = h.references.findLast(value => value?.state === 'playing'); assert.ok(before);
      const video = videoConsumer(h, before);
      if (failure === 'eof') { const request = h.requests.at(-1); request.closed = true; request.controller.close(); await h.settle(); }
      else previousNode.onprocessorerror();
      const resolved = h.audioReferences.resolve('carplay', before.sourceTimeMs, 3, h.now);
      assert.equal(resolved.required, true, `${failure} must keep audio required while output is unavailable`);
      assert.notEqual(resolved.state, 'video-only');
      assert.equal(h.references.at(-1).audibleTimeMs, null);
      video.assertIndependent();
      h.advanceWall(failure === 'eof' ? 1001 : 101); await h.settle();
      await h.feed(96000, { epoch: 8, restart: true });
      for (let i = 0; i < 40; i++) h.quantum();
      const after = h.references.findLast(value => value?.state === 'playing');
      assert.ok(after.generation > before.generation, `${failure} resumes in a fresh playback generation`);
      assert.equal(after.epoch, 8);
      const count = h.references.length;
      staleCallback({ data: { playout: { ...before, contextTimeMs: h.context.currentTime * 1000 } } });
      assert.equal(h.references.length, count, 'retired-node and same-node old-generation callbacks cannot revive old output');
      assert.equal(h.audioReferences.update({ ...before, at: h.now }), false);
      assert.equal(h.audioReferences.resolve('carplay', after.sourceTimeMs, 3, h.now).reference.epoch, 8);
      video.close();
    } finally { await h.close(); }
  }
});

test('clock generation recovery rejects earlier source/output references without reusing epoch arithmetic', async () => {
  const h = await harness();
  try {
    await h.playing();
    const before = h.references.findLast(value => value?.state === 'playing'); assert.ok(before);
    const video = videoConsumer(h, before);
    h.audio.clock(h.calibration(4)); h.drain();
    assert.equal(h.audioReferences.resolve('carplay', before.sourceTimeMs, 4, h.now).state, 'clock-generation');
    video.assertIndependent(4);
    for (let i = 0; i < 30; i++) h.quantum();
    const after = h.references.findLast(value => value?.state === 'playing');
    assert.equal(after.clockGeneration, 4);
    assert.equal(after.generation, before.generation);
    assert.ok(after.sequence > before.sequence);
    assert.equal(h.audioReferences.update({ ...before, at: h.now }), false);
    assert.equal(h.audioReferences.resolve('carplay', after.sourceTimeMs, 4, h.now).state, 'audio-output');
    video.close();
  } finally { await h.close(); }
});

test('a queued old-generation report cannot repopulate output after an explicit reset', async () => {
  const h = await harness();
  try {
    await h.playing();
    const before = h.references.findLast(value => value?.state === 'playing'); assert.ok(before);
    const pendingFeedback = h.feedback.findLast(value => value.state === 'playing');
    h.audio.reset(); h.drain();
    const count = h.references.length;
    // This is a real report emitted before reset, delivered from the same live
    // MessagePort after reset. Browser tasks can be pending in precisely this order.
    h.nodes[0].port.onmessage({ data: { playout: pendingFeedback } });
    assert.equal(h.references.length, count, 'main thread rejects reports from retired playback generations');
    assert.equal(h.audioReferences.resolve('carplay', before.sourceTimeMs, 3, h.now).state, 'video-only');
  } finally { await h.close(); }
});

test('render-age diagnostics do not mistake accumulated context-clock offset for a stale report', async () => {
  const h = await harness({ devicePpm: -4000 });
  try {
    await h.playing();
    h.audio.debug(true); h.drain();
    h.context.frames += 480000;
    h.advanceWall(10040);
    h.quantum();
    const details = h.audio.stats().debug;
    assert.equal(details.renderReportAgeMs, 0);
    assert.ok(details.renderAgeMs >= 0 && details.renderAgeMs < 5,
      `fresh worklet report acquired a fictitious ${details.renderAgeMs}ms age from clock offset`);
  } finally { await h.close(); }
});
