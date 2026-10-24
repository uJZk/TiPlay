// SPDX-License-Identifier: GPL-3.0-only
// Includes input staging, output copies and allocations; no compute-only comparison.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { downmixStereo } from '../../../site/play/airplay-tempo.js';

const directory = process.argv[2] || 'work/downmix-probes';
function oldDownmix(channels) {
  if (!channels.length || channels.some(channel => channel.length !== channels[0].length)) throw new TypeError();
  const left = new Float32Array(channels[0].length), right = new Float32Array(channels[0].length);
  for (let i = 0; i < left.length; i++) {
    if (channels.length === 4) {
      left[i] = (channels[0][i] + channels[2][i]) * .5;
      right[i] = (channels[1][i] + channels[3][i]) * .5;
    } else {
      left[i] = channels[0][i] + Math.SQRT1_2 * (channels[2][i] + channels[4][i]);
      right[i] = channels[1][i] + Math.SQRT1_2 * (channels[2][i] + channels[5][i]);
    }
  }
  return [left, right];
}
const artifacts = {};
async function candidate(filename) {
  const bytes = readFileSync(`${directory}/${filename}`);
  artifacts[filename] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const api = new WebAssembly.Instance(await WebAssembly.compile(bytes)).exports;
  const input = new Float32Array(api.memory.buffer, api.audio_input(), 32768);
  const output = new Float32Array(api.memory.buffer, api.audio_output(), 32768);
  return channels => {
    const left = new Float32Array(channels[0].length), right = new Float32Array(left.length);
    for (let offset = 0; offset < left.length; offset += 4096) {
      const frames = Math.min(4096, left.length - offset);
      for (let c = 0; c < channels.length; c++) input.set(channels[c].subarray(offset, offset + frames), c * frames);
      api.audio_downmix(frames, channels.length);
      left.set(output.subarray(0, frames), offset); right.set(output.subarray(frames, frames * 2), offset);
    }
    return [left, right];
  };
}
const functions = { originalJs: oldDownmix, selectedJs: downmixStereo,
  wasm: await candidate('downmix.wasm'), simd: await candidate('downmix.simd.wasm') };
const results = []; let sink = 0;
for (const count of [4, 6]) for (const frames of [128, 512, 1024, 2048, 4096, 8192, 16384, 32768]) {
  const channels = Array.from({ length: count }, (_, c) => Float32Array.from({ length: frames }, (_, i) => Math.sin((c + i) * .1) * .4));
  const expected = oldDownmix(channels);
  for (const fn of Object.values(functions)) assert.deepEqual(fn(channels), expected);
  const iterations = Math.max(500, Math.ceil(1000000 / frames));
  const rows = Object.fromEntries(Object.keys(functions).map(name => [name, []]));
  for (const fn of Object.values(functions)) for (let i = 0; i < 500; i++) sink += fn(channels)[0][0];
  for (let repeat = 0; repeat < 5; repeat++) {
    const order = Object.entries(functions); if (repeat % 2) order.reverse();
    for (const [name, fn] of order) {
      const at = performance.now();
      for (let i = 0; i < iterations; i++) sink += fn(channels)[0][0];
      rows[name].push((performance.now() - at) * 1000 / iterations);
    }
  }
  const medianUs = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, [...values].sort((a, b) => a - b)[2]]));
  results.push({ channels: count, frames, iterations, samplesExact: true, medianUs, trialsUs: rows });
}
console.log(JSON.stringify({ node: process.version, v8: process.versions.v8, artifacts, results, sink,
  limits: 'Shared-host wall time includes copies, allocation and GC. SIMD probe is a separate-boundary prototype; production fuses downmix into SoundTouch and must be measured separately.' }, null, 2));
