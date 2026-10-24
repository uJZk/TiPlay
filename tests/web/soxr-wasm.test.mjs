// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSoxr, prepareSoxr, SoxrRuntime } from '../../site/play/streaming-resampler.js';

test('compiled resampler code is shared while heaps and filter state stay isolated', async () => {
  const module = await loadSoxr();
  assert.equal(await loadSoxr(), module);
  assert.throws(() => prepareSoxr({}), /Invalid/);
  const first = new SoxrRuntime({ module }), second = new SoxrRuntime({ module });
  assert.notEqual(first.exports.memory.buffer, second.exports.memory.buffer);
  assert.throws(() => first.exports.memory.grow(1), RangeError);
  const a = first.create(44100, 48000, 2), b = second.create(44100, 48000, 2);
  try {
    const signal = Float32Array.from({ length: 8192 }, (_, i) => Math.sin(i * .17) * .4);
    const output = new Float32Array(1024), silent = new Float32Array(1024);
    assert.ok(a.process(signal, 4096, output).produced > 0);
    assert.ok(b.process(new Float32Array(8192), 4096, silent).produced > 0);
    assert.ok(output.some(sample => Math.abs(sample) > .01));
    assert.ok(silent.every(sample => sample === 0));
  } finally { a.dispose(); b.dispose(); }
});

test('complete upstream constant-rate engines and integer/float IO remain available', () => {
  const { exports: api } = new SoxrRuntime();
  // Exercise the public WASM C ABI directly, including its struct-return pointers.
  // This protects the complete dependency from accidental float32/VR-only pruning.
  const buffers = [];
  const allocate = bytes => { const pointer = api.malloc(bytes); assert.ok(pointer); buffers.push(pointer); return pointer; };
  const inputDone = allocate(4), outputDone = allocate(4), io = allocate(32), quality = allocate(48);
  try {
    for (const [type, ArrayType, amplitude] of [[0, Float32Array, .4], [1, Float64Array, .4], [2, Int32Array, 400000000], [3, Int16Array, 10000]]) {
      const input = allocate(4096 * ArrayType.BYTES_PER_ELEMENT), output = allocate(5000 * ArrayType.BYTES_PER_ELEMENT);
      const samples = new ArrayType(api.memory.buffer, input, 4096);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 2 * Math.PI * 997 / 44100) * amplitude;
      api.soxr_io_spec(io, type, type);
      for (const precision of [0, 16]) {
        api.soxr_quality_spec(quality, 4, precision);
        assert.equal(api.soxr_oneshot(44100, 48000, 1, input, 4096, inputDone,
          output, 5000, outputDone, io, quality, 0), 0);
        assert.equal(new Uint32Array(api.memory.buffer, inputDone, 1)[0], 4096);
        const produced = new Uint32Array(api.memory.buffer, outputDone, 1)[0];
        assert.ok(produced >= 4450 && produced <= 4460);
        const result = new ArrayType(api.memory.buffer, output, produced);
        assert.ok(result.every(Number.isFinite));
        assert.ok(result.some(sample => Math.abs(sample) > amplitude * .8));
      }
    }
  } finally { for (const pointer of buffers) api.free(pointer); }
});

test('invalid buffers and closed streams cannot cross the WASM memory boundary', () => {
  const runtime = new SoxrRuntime();
  for (const format of [[0, 48000, 2], [48000, Infinity, 2], [48000, 48000, 0], [48000, 48000, 3]]) {
    assert.throws(() => runtime.create(...format), /Invalid/);
  }
  const stream = runtime.create(48000, 48000, 2), input = new Float32Array(256), output = new Float32Array(256);
  for (const frames of [-1, NaN, 128.5, 129]) assert.throws(() => stream.process(input, frames, output), /Invalid/);
  assert.throws(() => stream.process(input, 128, new Float32Array(1), 128), /Invalid/);
  assert.throws(() => stream.setRatio(1, -1), /Invalid/);
  stream.dispose(); stream.dispose();
  assert.throws(() => stream.process(input, 128, output), /disposed/);
  assert.throws(() => stream.setRatio(1), /disposed/);
});
