// SPDX-License-Identifier: GPL-3.0-only
// Whole-adapter CPU comparison, including planar/interleaved copies and disposal.
// Compilation/download are startup work and intentionally measured separately.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { createTempoProcessor } from '../../../site/play/airplay-tempo.js';
import { loadSoundTouch } from '../../../site/play/vendor/soundtouch/soundtouch.js';

const baselineCommit = '5ea829adf39d87bb1d3fc4360528fe5f3c590d7a';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = resolve(root, 'work/soundtouch-benchmark');
await mkdir(scratch, { recursive: true });
for (const [name, path] of [['media.mjs', 'site/play/vendor/mediabunny/mediabunny.min.js'],
  ['tempo.mjs', 'site/play/airplay-tempo.js']]) {
  await writeFile(resolve(scratch, name), execFileSync('git', ['show', `${baselineCommit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 }));
}
const baseline = await import(pathToFileURL(resolve(scratch, 'tempo.mjs')));
const { SoundTouchCore } = await import(pathToFileURL(resolve(scratch, 'media.mjs')));
const compileMs = {}, engines = {};
for (const [name, file] of [['wasm', 'soundtouch.wasm'], ['simd', 'soundtouch.simd.wasm']]) {
  const bytes = await readFile(new URL(`../../../site/play/vendor/soundtouch/${file}`, import.meta.url));
  const start = performance.now();
  engines[name] = await loadSoundTouch({ bytes, simd: name === 'simd', cache: false });
  compileMs[name] = performance.now() - start;
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (const sampleRate of [44100, 48000]) for (const chunk of [512, 1024, 4096]) for (const rate of [0.5, 1.25, 2]) {
  const input = Float32Array.from({ length: sampleRate * 30 }, (_, i) =>
    0.4 * Math.sin(2 * Math.PI * 440 * i / sampleRate) + 0.2 * Math.sin(2 * Math.PI * 997 * i / sampleRate));
  const runners = {
    js: () => baseline.createTempoProcessor(SoundTouchCore, sampleRate, rate),
    wasm: () => createTempoProcessor(engines.wasm, sampleRate, rate),
    simd: () => createTempoProcessor(engines.simd, sampleRate, rate),
  };
  const row = { sampleRate, chunk, rate };
  for (const [name, factory] of Object.entries(runners)) {
    const timings = [];
    for (let run = 0; run < 7; run++) {
      const start = process.cpuUsage(), processor = factory();
      let frames = 0, checksum = 0;
      for (let offset = 0; offset < input.length; offset += chunk) {
        const block = processor.push(input.subarray(offset, offset + chunk));
        if (block) { frames += block.length / 2; checksum += block[block.length >> 1]; }
      }
      const tail = processor.finish(); if (tail) { frames += tail.length / 2; checksum += tail[tail.length >> 1]; }
      processor.dispose();
      const cpu = process.cpuUsage(start), elapsed = (cpu.user + cpu.system) / 1000;
      if (Math.abs(frames - Math.round(input.length / rate)) > sampleRate * 0.01 || !Number.isFinite(checksum)) throw new Error('Invalid benchmark output.');
      if (run >= 2) timings.push(elapsed);
    }
    row[`${name}Ms`] = median(timings);
  }
  row.speedup = row.jsMs / row.simdMs;
  rows.push(row);
}
const result = { runtime: process.version, architecture: process.arch, cpu: cpus()[0]?.model,
  metric: 'process CPU milliseconds, including conversion/copies/instance/flush/dispose',
  baselineCommit, secondsPerCase: 30, warmupRepetitions: 2, repetitions: 5, compileMs, rows };
await writeFile(resolve(scratch, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
