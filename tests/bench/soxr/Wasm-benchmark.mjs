// SPDX-License-Identifier: GPL-3.0-only
// Compare the actual WASM reactor with a checksummed historical wasm2js factory.
// node --disallow-code-generation-from-strings tests/bench/soxr/Wasm-benchmark.mjs work/soxr-before.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { prepareSoxr, SoxrRuntime } from '../../../site/play/streaming-resampler.js';

const reference = process.argv[2];
if (!reference) throw new Error('Pass the historical wasm2js factory restored into work/.');
const referenceBytes = readFileSync(reference);
assert.equal(createHash('sha256').update(referenceBytes).digest('hex'), '0dda221ebb9979a01840c475caed3d9aee84c436f4a1e91483a868ca5df85777');
const wasmBytes = readFileSync(new URL('../../../site/play/vendor/soxr/soxr.wasm', import.meta.url));
const started = performance.now();
prepareSoxr(await WebAssembly.compile(wasmBytes));
const compileMs = performance.now() - started;
const oldFactory = (await import(pathToFileURL(reference).href)).default;
const createRuntime = backend => {
  const runtime = new SoxrRuntime();
  if (backend === 'wasm2js') {
    runtime.exports = oldFactory().exports;
    runtime.heap = new Float32Array(runtime.exports.memory.buffer);
  }
  return runtime;
};
function convert(runtime, rate, outputRate, channels, slew) {
  const frames = Math.ceil(rate * .35), input = Float32Array.from({ length: frames * channels }, (_, i) =>
    i % channels ? 0 : .3 * Math.sin(Math.floor(i / channels) * 2 * Math.PI * 997 / rate));
  const stream = runtime.create(rate, outputRate, channels), output = [], block = new Float32Array(128 * channels);
  let consumed = 0, boundary = Math.min(137, frames), calls = 0;
  try {
    while (calls++ < frames * 2) {
      if (consumed === boundary) boundary = Math.min(frames, boundary + 137);
      if (slew) stream.setRatio(rate / outputRate * (1 + .049 * Math.sin(calls / 100)), 128);
      const result = stream.process(input.subarray(consumed * channels, boundary * channels), boundary - consumed, block);
      consumed += result.consumed;
      for (let i = 0; i < result.produced * channels; i++) output.push(block[i]);
      if (!result.consumed && !result.produced && consumed === frames) break;
    }
    assert.equal(consumed, frames);
    assert.ok(output.every(Number.isFinite));
    return output;
  } finally { stream.dispose(); }
}
const parity = [];
const wasm = createRuntime('wasm'), previous = createRuntime('wasm2js');
for (const rate of [8000, 16000, 24000, 32000, 44100, 48000, 96000]) {
  for (const outputRate of [44100, 48000]) for (const channels of [1, 2]) {
    for (const slew of [false, true]) {
      const actual = convert(wasm, rate, outputRate, channels, slew), expected = convert(previous, rate, outputRate, channels, slew);
      assert.deepEqual(actual, expected, `waveform parity ${rate}/${outputRate}/${channels}/${slew}`);
      if (channels === 2) assert.ok(actual.every((value, index) => index % 2 === 0 || value === 0));
    }
    assert.equal(wasm.filterDelay(rate, outputRate), previous.filterDelay(rate, outputRate));
    parity.push({ rate, outputRate, channels, exactStaticAndSlew: true, delayMs: wasm.filterDelay(rate, outputRate) });
  }
}
const blocks = 5000, warmup = 500;
function benchmark(backend, rate, channels) {
  const runtime = createRuntime(backend), stream = runtime.create(rate, 48000, channels);
  const input = Float32Array.from({ length: 4096 * channels }, (_, i) => Math.sin(i * .07) * .2), output = new Float32Array(128 * channels);
  const render = index => {
    const ratio = rate / 48000 * (1 + Math.sin(index / 1000) * .0005);
    stream.setRatio(ratio, 128);
    let produced = 0;
    for (let call = 0; call < 16 && produced < 128; call++) {
      const frames = call ? Math.min(4096, Math.ceil((128 - produced) * ratio) + Math.ceil(rate * .006)) : 0;
      const result = stream.process(input, frames, output, 128 - produced);
      produced += result.produced;
    }
    assert.equal(produced, 128);
  };
  try {
    for (let i = 0; i < warmup; i++) render(i);
    const elapsed = new Float64Array(blocks), cpuStart = process.cpuUsage();
    for (let i = 0; i < blocks; i++) { const at = performance.now(); render(i + warmup); elapsed[i] = performance.now() - at; }
    const cpu = process.cpuUsage(cpuStart), cpuMs = (cpu.user + cpu.system) / 1000;
    elapsed.sort();
    return { backend, rate, channels, blocks, warmup, cpuMsPerAudioSecond: cpuMs / (blocks * 128 / 48000),
      meanBlockMs: elapsed.reduce((sum, value) => sum + value, 0) / blocks,
      p95Ms: elapsed[Math.ceil(blocks * .95) - 1], p99Ms: elapsed[Math.ceil(blocks * .99) - 1], maxMs: elapsed.at(-1),
      deadlineMisses: elapsed.filter(value => value > 128000 / 48000).length };
  } finally { stream.dispose(); }
}
const timing = [];
for (let repeat = 0; repeat < 3; repeat++) {
  for (const backend of repeat % 2 ? ['wasm2js', 'wasm'] : ['wasm', 'wasm2js']) {
    for (const [rate, channels] of [[8000, 1], [44100, 2], [48000, 2]]) timing.push({ repeat, ...benchmark(backend, rate, channels) });
  }
}
console.log(JSON.stringify({ node: process.version, v8: process.versions.v8,
  wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'), wasmBytes: wasmBytes.length,
  wasm2jsBytes: referenceBytes.length, compileMs, parity, timing,
  limits: 'Shared-host desktop CPU/wall observations include wrapper and timing overhead; they do not establish vehicle performance or hard deadlines.' }, null, 2));
