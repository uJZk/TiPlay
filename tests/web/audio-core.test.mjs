// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioKernel, loadAudioCore } from '../../site/play/wasm/audio-core.js';

const state = channels => ({ channels, fadeFrames: 240, gain: 0, recoveryRemaining: 240,
  tailRemaining: 240, last: new Float32Array(channels), recoveryTail: new Float32Array(channels).fill(.5) });

test('audio core has no host imports or growing memory', async () => {
  const module = await loadAudioCore(), kernel = new AudioKernel(module);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.equal(kernel.api.memory.buffer.byteLength, 1024 * 1024);
  assert.throws(() => kernel.api.memory.grow(1), RangeError);
});

test('finite tail is identical across output block partitions', () => {
  const kernel = new AudioKernel(), whole = state(2), split = state(2);
  whole.last.fill(.25); split.last.fill(.25);
  const expected = new Float32Array(1024), actual = new Float32Array(1024);
  kernel.tail(expected, 0, 512, whole);
  kernel.tail(actual, 0, 31, split); kernel.tail(actual, 31, 97, split); kernel.tail(actual, 128, 384, split);
  assert.deepEqual(actual, expected); assert.ok(actual.slice(480).every(value => value === 0));
});

test('PCM16 conversion preserves signed endpoints at small and large batches', () => {
  const kernel = new AudioKernel();
  for (const samples of [0, 3, 128, 512, 8192]) {
    const input = Int16Array.from({ length: samples }, (_, i) => [-32768, -1, 0, 1, 32767][i % 5]);
    const output = new Float32Array(samples + 4).fill(.125);
    kernel.pcm16(input, 0, output, 2, samples);
    assert.equal(output[0], .125); assert.equal(output.at(-1), .125);
    for (let i = 0; i < samples; i++) assert.equal(output[i + 2], input[i] / 32768);
  }
  assert.throws(() => kernel.pcm16(new Int16Array(), 0, new Float32Array(), 0, -1), RangeError);
});

test('mixer duplicates mono, applies one shared focus envelope and clips the final sum', () => {
  const kernel = new AudioKernel(), frames = 512;
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const continuous = [[0, { semanticType: 0, channels: 1, state: 'playing', block: new Float32Array(frames).fill(.5) }, frames],
    [255, { semanticType: 1, channels: 2, state: 'rebuffering', block: new Float32Array(frames * 2) }, 240]];
  const diagnostics = { renderNonzero: 0, renderPeak: 0 };
  const gain = kernel.mix(continuous, [], output, 1, .8 / 240, diagnostics);
  for (let i = 0; i < frames; i++) {
    const expectedGain = i < 240 ? Math.max(.2, 1 - (i + 1) * .8 / 240) : Math.min(1, .2 + (i - 239) * .8 / 240);
    assert.ok(Math.abs(output[0][i] - .5 * expectedGain) < 1e-6);
  }
  assert.deepEqual(output[0], output[1]);
  assert.equal(gain, 1); assert.equal(diagnostics.renderNonzero, frames * 2);
  continuous[0][1].block.fill(4);
  kernel.mix(continuous.slice(0, 1), [], output, 1, .8 / 240, null);
  assert.ok(output.flatMap(channel => [...channel]).every(value => value === 1));
});

test('8192-frame mixing carries voice prefixes and retired tails across the fixed arena boundary', () => {
  const kernel = new AudioKernel(), frames = 8192, step = .8 / 240;
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const continuous = [[0, { semanticType: 0, channels: 1, state: 'playing',
    block: new Float32Array(frames).fill(.25) }, frames],
    [255, { semanticType: 1, channels: 1, state: 'rebuffering',
      block: new Float32Array(frames) }, 5000]];
  const tail = { type: 1, samples: Float32Array.of(.125), remaining: 6000, total: 6000 };
  const diagnostics = { renderNonzero: 0, renderPeak: 0 };
  const actualGain = kernel.mix(continuous, [tail], output, 1, step, diagnostics);
  let gain = 1, peak = 0;
  for (let i = 0; i < frames; i++) {
    const target = i < 6000 ? .2 : 1;
    gain += Math.sign(target - gain) * Math.min(step, Math.abs(target - gain));
    const expected = Math.fround(.25 * gain + (i < 6000 ? .125 * (5999 - i) / 6000 : 0));
    assert.equal(output[0][i], expected, `sample ${i}`);
    peak = Math.max(peak, Math.abs(expected));
  }
  assert.deepEqual(output[0], output[1]);
  assert.equal(actualGain, gain); assert.equal(tail.remaining, 0);
  assert.equal(diagnostics.renderNonzero, frames * 2); assert.equal(diagnostics.renderPeak, peak);
  assert.equal(kernel.api.memory.buffer.byteLength, 1024 * 1024);
});
