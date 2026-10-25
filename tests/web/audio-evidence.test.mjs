// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEvidence, packAudioEvidence, AUDIO_EVIDENCE_BYTES } from '../../site/play/audio-evidence.js';
import { AudioKernel } from '../../site/play/wasm/audio-core.js';

function harness(clock = 'monotonic') {
  let at = 0, frame = 0; const events = [];
  const recorder = new AudioEvidence(48000, e => events.push(e), () => at, clock);
  function block(value = .125, fault = null, duration = .1, size = 128) {
    const output = [new Float32Array(size).fill(value), new Float32Array(size).fill(-value)];
    recorder.begin(frame, frame, size, 2, 0, frame);
    if (fault) recorder.trigger(fault, { observedFrame: frame + 256, expectedFrame: frame, deltaFrames: 256 });
    at += duration; recorder.end(output, 1); frame += size; at += 2.6;
  }
  return { recorder, events, block };
}
test('retains exact pre/post waveform, raw counter discrepancy and immutable first trigger', () => {
  const h = harness(); for (let i = 0; i < 4; i++) h.block(.1 + i * .01);
  h.block(.2, 'device-clock-jump'); h.block(.21); h.block(.22);
  assert.equal(h.events.length, 1);
  const e = h.events[0]; assert.equal(e.blocks.length, 6);
  assert.deepEqual(e.blocks.map(b => b.call), [2, 3, 4, 5, 6, 7]);
  assert.equal(e.causes[0].deltaFrames, 256); assert.equal(e.incomplete, false);
  const before = Array.from(e.blocks[0].wave); for (let i = 0; i < 10; i++) h.block(.3);
  assert.deepEqual(Array.from(e.blocks[0].wave), before, 'ring reuse cannot overwrite retained samples');
  const packed = packAudioEvidence(e, { receivedAtMs: 1000 });
  assert.ok(new TextEncoder().encode(JSON.stringify(packed)).length <= AUDIO_EVIDENCE_BYTES);
  const bytes = Buffer.from(packed.blocks.at(-1).pcm, 'base64');
  assert.equal(bytes.readFloatLE(), Math.fround(.22)); assert.equal(bytes.readFloatLE(4), Math.fround(-.22));
  assert.equal(packed.pcmFormat, 'f32le');
});
test('waveform-triggered capture does not substitute the trigger block for prehistory', () => {
  const h = harness(); h.block(.01); h.block(.02); h.block(.03); h.block(.9); h.block(.8); h.block(.7);
  const e = h.events[0]; assert.deepEqual(e.blocks.map(b => b.call), [1, 2, 3, 4, 5, 6]);
  assert.equal(e.causes[0].reason, 'output-edge'); assert.equal(e.blocks[2].wave[0], Math.fround(.03));
});
test('overload, wall-clock uncertainty, bounded suppression and truncated waveform remain explicit', () => {
  const h = harness(); h.block(.1, null, 4); h.block(); h.block();
  assert.equal(h.events[0].causes[0].reason, 'callback-budget');
  for (let i = 0; i < 30; i++) h.block(i % 2 ? .8 : -.8, 'frame-discontinuity');
  assert.equal(h.events.length, 1); assert.ok(h.recorder.stats().evidenceSuppressed > 0);
  const wall = harness('wall'); wall.block(.1, null, 500); assert.equal(wall.recorder.pending, null);
  wall.block(.1, 'packet-gap', .1, 512); wall.recorder.flush();
  assert.equal(wall.events[0].incomplete, true); assert.equal(wall.events[0].blocks.at(-1).waveFrames, 128);
  assert.equal(wall.events[0].blocks.at(-1).blockFrames, 512);
  const small = packAudioEvidence(h.events[0], {}, 4096);
  assert.ok(small.waveformOmittedBlocks > 0); assert.equal(packAudioEvidence(h.events[0], {}, 512), null);
});
test('pre-clamp mix evidence distinguishes a real over-range sum from clipped final samples without changing PCM', () => {
  const kernel = new AudioKernel(), frames = 128;
  const input = [[1, { channels: 1, state: 'playing', block: new Float32Array(frames).fill(.8) }, frames],
    [2, { channels: 1, state: 'playing', block: new Float32Array(frames).fill(.7) }, frames]];
  const ordinary = [new Float32Array(frames)], debug = [new Float32Array(frames)], metrics = { renderNonzero: 0, renderPeak: 0 };
  kernel.mix(input, [], ordinary, 1, .01, null); kernel.mix(input, [], debug, 1, .01, metrics);
  assert.deepEqual(debug, ordinary); assert.equal(debug[0][0], 1);
  assert.ok(metrics.mixPreClipPeak > 1.49); assert.equal(metrics.mixOverFullScaleSamples, 128);
  assert.equal(metrics.mixNonFiniteSamples, 0);
});
