// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { constantDelay } from '../../site/play/delay-plan.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { audioLimit } from '../../site/play/playback-window.js';

// Only the AudioWorklet host is synthetic. The production timeline and real
// Soxr process DC/low-frequency PCM so natural waveform slopes cannot hide clicks.
const calibration = { rate: 48000, outputRate: 48000, delayMs: new SoxrRuntime().filterDelay(48000, 48000) };
let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

function harness({ debug = false } = {}) {
  let frame = 0;
  globalThis.currentTime = 0; globalThis.currentFrame = 0;
  const processor = new Processor(), base = 8000000, cursors = new Map();
  const post = data => processor.port.onmessage({ data });
  post({ calibration, clock: { version: 2, generation: 1, serverOriginMs: base, localOriginMs: 0, rate: 1, state: 'locked', uncertaintyMs: 0 },
    contextAnchor: { contextTimeMs: 0, localTimeMs: 200 }, outputUncertaintyMs: 1,
    plans: { audio: constantDelay(60), video: constantDelay(0) } });
  if (debug) post({ debug: true, diagnosticRevision: 1 });
  function feed({ type = 0, semanticType = type, mode = 'carplay', epoch = 1, start = 0,
    until = frame + 19200, signal = () => 16384, channels = 1 } = {}) {
    const key = `${type}:${epoch}`, cursor = cursors.get(key) ?? { frame: start, sequence: 0 };
    while (cursor.frame < until) {
      const frames = Math.min(960, until - cursor.frame);
      const pcm = Int16Array.from({ length: frames * channels }, (_, i) => signal(cursor.frame + Math.floor(i / channels), i % channels));
      post({ type, semanticType, mode, epoch, rate: 48000, channels, flags: 0, sequence: cursor.sequence++, generation: 3,
        presentationMs: base + cursor.frame / 48, decodeTimestampUs: cursor.frame / 48 * 1000,
        arrivalLocalTimeMs: frame / 48, pcm: pcm.buffer });
      cursor.frame += frames;
    }
    cursors.set(key, cursor);
  }
  function render(frames = 128) {
    globalThis.currentFrame = frame; globalThis.currentTime = frame / 48000;
    const output = [new Float32Array(frames), new Float32Array(frames)];
    processor.process([], [output]); frame += frames; return output;
  }
  return { processor, post, feed, render, base, get frame() { return frame; }, dispose() { post({ dispose: true }); } };
}

function maximumEdge(samples, first = 0) {
  let maximum = 0;
  for (let i = Math.max(1, first); i < samples.length; i++) maximum = Math.max(maximum, Math.abs(samples[i] - samples[i - 1]));
  return maximum;
}

function boundary({ frames = 128, mode = 'carplay', type = 0, action = 'end', debug = false, multiple = false, frequency = 0 } = {}) {
  const h = harness({ debug }), samples = [];
  let started = false, ended = false, backend;
  try {
    while (h.frame < 33600) {
      h.feed({ type, mode, signal: frequency ? frame => Math.round(16384 * Math.sin(frame * 2 * Math.PI * frequency / 48000)) : undefined });
      if (multiple) h.feed({ type: 6, mode: 'airplay-mirror', signal: () => 8192 });
      if (!started && h.frame >= 8192) {
        started = true;
        h.feed({ type: 255, semanticType: 1, start: h.frame, until: action === 'gap' ? h.frame + 4800 : h.frame + 24000, signal: () => 0 });
      }
      if (!ended && action !== 'gap' && h.frame >= 20480) {
        ended = true;
        h.post({ type: 255, semanticType: 1, mode: 'carplay', epoch: action === 'epoch' ? 2 : 1,
          flags: 2, ended: true, generation: 3, pcm: new ArrayBuffer(0) });
      }
      const output = h.render(frames);
      assert.deepEqual(output[0], output[1], 'mono duplication uses the same envelope in both output channels');
      samples.push(...output[0]);
      if (!backend && h.frame > 4096) backend = h.processor.timelines.get(type).backend;
      if (debug) for (const timeline of h.processor.timelines.values()) { timeline.stats(); timeline.reference(h.frame / 48); }
    }
    const media = h.processor.timelines.get(type);
    assert.equal(media.backend, backend, 'voice focus must not restart the media filter');
    assert.deepEqual(media.recoveryCounts, {}, 'gain changes cannot manufacture media recovery');
    assert.ok(samples.every(Number.isFinite));
    assert.ok(samples.every(value => Math.abs(value) < 1), 'the fixture has headroom and does not exercise clipping');
    return samples;
  } finally { h.dispose(); }
}

for (const [mode, type] of [['carplay', 0], ['airplay-mirror', 6]]) for (const frames of [64, 128, 256, 1024]) {
  test(`${mode}: ${frames}-frame real output smooths silent voice start/end and supply gaps`, () => {
    for (const action of ['end', 'gap', 'epoch']) {
      const samples = boundary({ frames, mode, type, action });
      // A full 0.4 DC step is bounded by the shared existing 5ms/240-frame envelope.
      assert.ok(maximumEdge(samples, 4096) < 0.0017, `${action}: ${maximumEdge(samples, 4096)}`);
      assert.ok(samples.slice(11000, 14000).some(value => Math.abs(value - .1) < .0001), 'voice still ducks media to 20%');
      assert.ok(samples.slice(25000).every(value => Math.abs(value - .5) < .0001), 'media returns to its full level');
    }
  });
}

test('multiple media streams share one gain advance, with Debug and reads preserving every sample', () => {
  const ordinary = boundary({ multiple: true }), observed = boundary({ multiple: true, debug: true });
  assert.deepEqual(observed, ordinary);
  assert.ok(maximumEdge(ordinary, 4096) < .00251, '0.75 DC sum ramps once per output frame, not once per stream or channel');
  assert.ok(ordinary.slice(11000, 14000).some(value => Math.abs(value - .15) < .0001));
});

test('low-frequency media focus edges remain close to the natural waveform slope', () => {
  const samples = boundary({ frequency: 50 });
  assert.ok(maximumEdge(samples, 4096) < .005, '50Hz signal cannot acquire the old 0.2-0.4 single-sample mixer step');
});

test('nonzero retired voice holds media ducking until the final tail sample', () => {
  const h = harness();
  try {
    for (let q = 0; q < 100; q++) { h.feed(); h.feed({ type: 255, semanticType: 1, signal: () => 4096 }); h.render(); }
    h.post({ type: 255, semanticType: 1, mode: 'carplay', epoch: 2, flags: 2, ended: true, generation: 3, pcm: new ArrayBuffer(0) });
    const first = h.render()[0];
    assert.equal(h.processor.retiring[0].remaining, 112);
    assert.equal(h.processor.mediaGain, .2, 'an audible retired voice tail still owns focus');
    const second = h.render()[0];
    assert.ok(h.processor.mediaGain > .2 && h.processor.mediaGain < .3, 'release starts when the 240-frame tail ends inside this quantum');
    assert.ok(maximumEdge([...first, ...second]) < .002, 'voice fade plus media release stays continuous');
  } finally { h.dispose(); }
});

test('legacy and timestamped media use the same smooth focus envelope', () => {
  for (const timed of [false, true]) {
    const h = harness();
    try {
      h.post({ clock: null });
      if (timed) h.post({ clockBase: 1060 });
      for (const type of [0, 1]) h.post({ type, epoch: 1, generation: 3, rate: 48000, channels: 1, flags: 0,
        ...(timed ? { sourceTime: 1000, sequence: 0 } : { sourceTime: NaN }),
        pcm: new Int16Array(960).fill(type ? 0 : 16384).buffer });
      const first = h.render()[0], second = h.render()[0];
      assert.ok(first[0] > .49 && first.at(-1) > .28 && first.at(-1) < .29);
      assert.ok(Math.abs(second.at(-1) - .1) < 1e-6);
      assert.ok(maximumEdge([...first, ...second]) < .0017);
    } finally { h.dispose(); }
  }
});

function warmRetirement({ action = 'end', mode = 'carplay', type = 0, frames = 128, debug = true } = {}) {
  const h = harness({ debug });
  while (h.frame < 12800) { h.feed({ type, mode }); h.render(frames); }
  const player = h.processor.timelines.get(type);
  if (action === 'reset') h.post({ reset: true, generation: 4 });
  else h.post({ type, semanticType: type, mode, epoch: action === 'epoch' ? 2 : 1,
    generation: 3, flags: 2, ended: true, pcm: new ArrayBuffer(0) });
  assert.equal(h.processor.retiring.length, 1);
  assert.equal(player.backend, null, 'retiring disposes the filter and releases all PCM');
  assert.equal(player.queue.length, 0);
  assert.ok(Object.values(h.processor.retiring[0]).every(value => !value || typeof value !== 'object' || value instanceof Float32Array),
    'the worklet holds only scalar metadata and the bounded channel sample');
  return h;
}

for (const action of ['end', 'epoch', 'reset']) for (const mapping of ['output', 'source']) {
  test(`${action}: a ${mapping} clock step cannot leak expired retired PCM`, () => {
    const h = warmRetirement({ action });
    try {
      const contextSpanMs = h.frame / 48 + 128 / 48;
      if (mapping === 'output') h.post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 1200 } });
      else h.post({ clock: { version: 2, generation: 2, serverOriginMs: h.base + 1000, localOriginMs: 0,
        rate: 1, state: 'locked', uncertaintyMs: 0 } });
      assert.ok(h.render()[0].every(value => value === 0));
      assert.equal(h.processor.retiring.length, 0);
      h.processor.report();
      const report = h.processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream0;
      assert.equal(report.lastRetiredSourceDeadlineEpoch, 1, 'the rejected tail retains its own epoch');
      assert.equal(report.lastRetiredSourceDeadlineGeneration, 3, 'reset cannot relabel the tail as the new playback generation');
      assert.equal(report.retiredSourceDeadlineRejectedFrames, 240);
      assert.equal(report.lastRetiredSourceDeadlineLimitMs, 300);
      assert.ok(Math.abs(report.lastRetiredSourceDeadlineUncertaintyMs - (2 + contextSpanMs * (1 / .98 - 1))) < 1e-12,
        'the rejected tail includes measured/filter uncertainty and its actual native-anchor projection');
      assert.ok(report.lastRetiredSourceDeadlineDeltaUpperMs > 1000);
      assert.equal(report.lastRetiredSourceDeadlineAgeMs, 0);
      assert.equal(report.sourceDeadlineRejectedFrames, undefined, 'retired rejections do not masquerade as current timeline output');
    } finally { h.dispose(); }
  });
}

test('known legal retired tails retain their complete envelope at every real quantum size', () => {
  for (const frames of [64, 128, 256, 1024]) {
    const h = warmRetirement({ frames });
    try {
      const samples = [];
      while (samples.length < 512) samples.push(...h.render(frames)[0]);
      assert.ok(samples[0] > .49);
      assert.ok(samples[238] > 0 && samples[239] === 0);
      assert.ok(samples.slice(240).every(value => value === 0));
      assert.equal(h.processor.retiredDeadlineReports.size, 0, 'valid output must not manufacture a deadline rejection');
    } finally { h.dispose(); }
  }
});

test('retired output uses its own mode limit and checks both sides of the deadline boundary', () => {
  for (const [mode, type] of [['carplay', 0], ['airplay-mirror', 6]]) for (const offset of [-.001, .001]) {
    const h = warmRetirement({ mode, type, frames: 1024 });
    try {
      const tail = h.processor.retiring[0], contextMs = h.frame / 48;
      // The tail holds one source sample; output age grows over its 240 frames.
      const mappedSource = tail.sourceTimeMs - h.base;
      const tailProjectionMs = 5 * (1 / .98 - 1);
      h.post({ contextAnchor: { contextTimeMs: contextMs,
        localTimeMs: mappedSource + audioLimit(mode) - 2 - 5 - tailProjectionMs + offset } });
      const output = h.render(1024)[0];
      assert.equal(output.some(value => value !== 0), offset < 0, `${mode} boundary ${offset}`);
      assert.equal(h.processor.retiredDeadlineReports.size, offset > 0 ? 1 : 0);
    } finally { h.dispose(); }
  }
});

test('unknown retired deadline evidence preserves the existing fade without claiming expiration', () => {
  for (const control of [{ contextAnchor: null }, { clock: null }, { outputUncertaintyMs: null },
    { clock: { version: 2, generation: 2, serverOriginMs: 8000000, localOriginMs: 0, rate: 1, state: 'stale', uncertaintyMs: 0 } }]) {
    const h = warmRetirement();
    try {
      h.post(control);
      assert.ok(h.render()[0].some(value => value > .2));
      assert.equal(h.processor.retiredDeadlineReports.size, 0);
    } finally { h.dispose(); }
  }
});

test('retired evidence keeps its old identity beside a replacement and clears for reset or new Debug', () => {
  const h = warmRetirement({ action: 'epoch' });
  try {
    h.post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 1200 } });
    h.render();
    h.post({ contextAnchor: { contextTimeMs: 0, localTimeMs: 200 } });
    h.feed({ epoch: 3 }); h.render(); h.processor.report();
    const report = () => h.processor.messages.filter(value => value.diagnostics).at(-1).diagnostics.stream0;
    assert.equal(report().epoch, 3);
    assert.equal(report().lastRetiredSourceDeadlineEpoch, 1);
    assert.equal(report().lastRetiredSourceDeadlineGeneration, 3);
    assert.ok(report().lastRetiredSourceDeadlineAgeMs > 0);
    h.post({ reset: true, generation: 4 });
    assert.equal(h.processor.retiredDeadlineReports.size, 0);
    h.post({ debug: false }); h.post({ debug: true, diagnosticRevision: 2, generation: 4 });
    h.processor.report();
    assert.equal(report()?.lastRetiredSourceDeadlineEpoch, undefined);
    assert.equal(report()?.retiredSourceDeadlineRejectedFrames, undefined);
  } finally { h.dispose(); }
});
