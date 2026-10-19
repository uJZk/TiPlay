// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioCalibration } from '../../site/play/audio-calibration.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { createBrowserAudio } from '../../site/play/audio.js';
import { MAX_AUDIO_AHEAD_BYTES } from '../../site/play/audio-buffer-policy.js';

class CalibrationWorker {
  static instances = [];
  constructor() { this.requests = []; CalibrationWorker.instances.push(this); }
  postMessage(value) { this.requests.push(value); }
  reply(index = this.requests.length - 1, extra = {}) {
    const request = this.requests[index]; this.onmessage({ data: { ...request, delayMs: 0.15, ...extra } });
  }
  terminate() { this.terminated = true; }
}

test('real calibration runs outside the rendering runtime and cold worklet lookup cannot measure', async () => {
  const calibration = createAudioCalibration({ Worker: null }), runtime = new SoxrRuntime({ allowCalibration: false });
  try {
    assert.throws(() => runtime.filterDelay(44100, 48000), /not prepared/);
    const measured = await calibration.prepare(44100, 48000);
    assert.ok(Number.isFinite(measured.delayMs));
    runtime.setCalibration(measured.rate, measured.outputRate, measured.delayMs);
    assert.equal(runtime.filterDelay(44100, 48000), measured.delayMs);
    assert.throws(() => runtime.filterDelay(44100, 44100), /not prepared/, 'the output format is part of the measurement identity');
    for (let rate = 8000; rate < 8020; rate++) runtime.setCalibration(rate, 48000, 0);
    assert.equal(runtime.calibrations.size, 16);
  } finally { calibration.dispose(); }
});

test('a calibration probe always releases its backend when DSP fails', () => {
  const runtime = new SoxrRuntime(); let disposed = 0;
  runtime.create = () => ({ process() { throw new Error('DSP failed'); }, dispose() { disposed++; } });
  assert.throws(() => runtime.filterDelay(48000, 48000), /DSP failed/);
  assert.equal(disposed, 1); assert.equal(runtime.calibrations.size, 0);
});

test('worker requests deduplicate, stay bounded and terminate with every waiter settled on disposal', async () => {
  const calibration = createAudioCalibration({ Worker: CalibrationWorker });
  const first = calibration.prepare(48000, 48000), same = calibration.prepare(48000, 48000);
  assert.equal(first, same);
  const worker = CalibrationWorker.instances.at(-1); worker.reply();
  assert.equal((await first).delayMs, 0.15);
  assert.deepEqual(await calibration.prepare(48000, 48000), await first);
  assert.equal(worker.requests.length, 1);
  const pending = Array.from({ length: 16 }, (_, i) => calibration.prepare(8000 + i, 48000));
  await assert.rejects(calibration.prepare(9000, 48000), /Too many pending/);
  calibration.dispose();
  assert.ok(worker.terminated);
  assert.ok((await Promise.allSettled(pending)).every(result => result.status === 'rejected'));
});

test('worker failure, malformed results and timeout reject preparation rather than leaving ready pending', async () => {
  for (const failure of ['error', 'malformed', 'timeout']) {
    const calibration = createAudioCalibration({ Worker: CalibrationWorker, timeoutMs: 20 });
    const promise = calibration.prepare(48000, 48000), worker = CalibrationWorker.instances.at(-1);
    if (failure === 'error') worker.onerror();
    if (failure === 'malformed') worker.reply(0, { rate: 44100 });
    await assert.rejects(promise, /failed|Invalid|timed out/);
    assert.ok(worker.terminated); calibration.dispose();
  }
});

test('retired worker callbacks cannot fail a replacement calibration', async () => {
  const calibration = createAudioCalibration({ Worker: CalibrationWorker });
  try {
    const cancelled = calibration.prepare(44100, 48000), retired = CalibrationWorker.instances.at(-1);
    const rejected = assert.rejects(cancelled, /cancelled/);
    calibration.cancel(); await rejected;
    const replacement = calibration.prepare(48000, 48000), active = CalibrationWorker.instances.at(-1);
    // A callback already queued on the main thread may outlive worker termination.
    retired.onerror(); retired.onmessageerror(); retired.reply(0, { error: 'old failure' });
    assert.notEqual(active.terminated, true);
    active.reply();
    assert.equal((await replacement).rate, 48000);
  } finally { calibration.dispose(); }
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function browser({ holdRate = null, prepareReply = true } = {}) {
  const saved = Object.fromEntries(['Worker', 'AudioContext', 'AudioWorkletNode'].map(key => [key, globalThis[key]]));
  const nodes = [], workers = [], requests = [];
  globalThis.Worker = class extends CalibrationWorker {
    constructor(...args) { super(...args); workers.push(this); }
    postMessage(value) { super.postMessage(value); if (value.rate !== holdRate) queueMicrotask(() => this.reply()); }
  };
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() {
      nodes.push(this); this.messages = []; this.connected = false;
      this.port = { postMessage: value => {
        this.messages.push(value);
        if (value.prepare && prepareReply) queueMicrotask(() => this.port.onmessage?.({ data: { prepared: value.prepare.id } }));
      } };
    }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  };
  const audio = createBrowserAudio({ credentials: () => ({}), fetchPhone: async () => {
    const request = {}; requests.push(request);
    return { ok: true, body: new ReadableStream({ start(controller) { request.controller = controller; } }) };
  } });
  const pcm = (bytes, rate = 48000) => {
    const record = new Uint8Array(bytes + 28), header = new DataView(record.buffer);
    header.setUint32(0, bytes + 24); record[4] = 2; record[6] = 2; header.setUint32(8, rate); header.setFloat64(20, NaN);
    requests.at(-1).controller.enqueue(record);
  };
  return { audio, nodes, workers, requests, pcm, holdRate(value) { holdRate = value; },
    prepareReply(value) { prepareReply = value; }, done() { audio.dispose(); Object.assign(globalThis, saved); } };
}

test('node output stays disconnected until real preparation acknowledgement, and disposal cancels the handshake', async () => {
  const h = browser({ prepareReply: false });
  try {
    const activation = h.audio.activate(); await tick();
    assert.equal(h.nodes.length, 1); assert.equal(h.nodes[0].connected, false);
    h.audio.dispose(); await activation;
    assert.equal(h.nodes[0].connected, false); assert.equal(h.workers[0].terminated, true);
  } finally { h.done(); }
});

test('failed worklet preparation is explicit and never connects a failed node', async () => {
  const h = browser({ prepareReply: false });
  try {
    const activation = h.audio.activate(); await tick();
    const node = h.nodes[0], prepare = node.messages.find(value => value.prepare).prepare;
    node.port.onmessage({ data: { prepareError: prepare.id, error: 'Preparation failed' } });
    await activation;
    assert.match(h.audio.stats().error, /Preparation failed/); assert.equal(node.connected, false);
  } finally { h.done(); }
});

test('cold raw PCM shares the existing queued-byte budget with prepared media', async () => {
  const h = browser({ holdRate: 44100 });
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    for (let packet = 0; packet < 5; packet++) h.pcm(192000);
    await tick(); assert.equal(h.audio.stats().queuedBytes, 960000);
    h.pcm(176400, 44100); await tick();
    assert.match(h.audio.stats().error, /preparation exceeds/);
    assert.ok(h.audio.stats().queuedBytes <= MAX_AUDIO_AHEAD_BYTES);
    assert.equal(h.nodes[0].messages.filter(value => value.pcm?.byteLength).length, 5);
    assert.equal(h.workers[0].requests.length, 1, 'over-budget cold PCM is rejected before scheduling calibration');
  } finally { h.done(); }
});

test('cancelled cold-format PCM releases its reservation and cannot publish into a replacement generation', async () => {
  const h = browser({ holdRate: 44100 });
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    h.pcm(1764, 44100); await tick(); assert.equal(h.audio.stats().queuedBytes, 1764);
    h.audio.reset(); assert.equal(h.audio.stats().queuedBytes, 0);
    h.workers[0].reply(); await tick();
    assert.equal(h.nodes[0].messages.filter(value => value.pcm?.byteLength).length, 0);
    assert.equal(h.audio.stats().queuedBytes, 0);
  } finally { h.done(); }
});

test('attach and replacement during cold startup preserve the node preparation owner', async () => {
  const h = browser({ holdRate: 48000 });
  try {
    const activation = h.audio.activate(); await tick();
    const worker = h.workers[0]; assert.equal(h.nodes.length, 0);
    h.audio.attach(new AbortController().signal, { audio: true }); h.audio.stop();
    h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    assert.equal(worker.terminated, undefined, 'stream cancellation cannot cancel the independent node calibration');
    worker.reply(); await activation; await tick();
    assert.equal(h.nodes.length, 1); assert.equal(h.nodes[0].connected, true);
    assert.equal(h.audio.stats().error, null); assert.ok(h.requests.length > 0);
  } finally { h.done(); }
});

test('cold-cache processor recovery, gesture and attach share one node installation', async () => {
  const h = browser();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    // Evict the initial format so recovery genuinely waits across tasks, not only a microtask.
    for (let rate = 8000; rate < 8017; rate++) { h.pcm(4, rate); await tick(); }
    h.holdRate(48000); h.nodes[0].onprocessorerror();
    await new Promise(resolve => setTimeout(resolve, 120));
    const worker = h.workers.at(-1); assert.equal(worker.requests.at(-1).rate, 48000);
    assert.equal(h.nodes.length, 1);
    h.audio.gesture(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    worker.reply(); await tick(); await tick();
    assert.equal(h.nodes.length, 2, 'all callers await the same installation');
    assert.equal(h.nodes[1].connected, true); assert.equal(h.audio.stats().error, null);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(h.nodes.length, 2); assert.equal(h.nodes[1].connected, true, 'no obsolete recovery can retire the replacement');
  } finally { h.done(); }
});

test('replacement connection during the recovery handshake starts playback without another gesture', async () => {
  const h = browser();
  try {
    await h.audio.activate(); h.audio.attach(new AbortController().signal, { audio: true }); await tick();
    h.prepareReply(false); h.nodes[0].onprocessorerror();
    await new Promise(resolve => setTimeout(resolve, 120));
    const replacement = h.nodes[1], prepare = replacement.messages.find(value => value.prepare).prepare;
    assert.equal(replacement.connected, false);
    h.audio.attach(new AbortController().signal, { audio: true });
    replacement.port.onmessage({ data: { prepared: prepare.id } }); await tick(); await tick();
    assert.equal(replacement.connected, true);
    assert.ok(h.requests.length >= 2, 'the replacement connection starts its audio stream after the shared preparation settles');
    assert.equal(h.audio.stats().processorFailed, false);
  } finally { h.done(); }
});
