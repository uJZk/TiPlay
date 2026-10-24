// SPDX-License-Identifier: GPL-3.0-only
// Complete adapter comparison: optimized JS downmix/interleave versus one-copy
// original planes with native downmix/interleave in the same upstream engine.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { createTempoProcessor, downmixStereo } from '../../../site/play/airplay-tempo.js';
import { loadSoundTouch } from '../../../site/play/vendor/soundtouch/soundtouch.js';
import { loadSoundTouch as loadReference } from './Js-interleave-reference.mjs';

const bytes = await readFile(new URL('../../../site/play/vendor/soundtouch/soundtouch.simd.wasm', import.meta.url));
const current = await loadSoundTouch({ bytes, simd: true, cache: false });
const reference = await loadReference({ bytes, simd: true, cache: false });
const allNative = await loadReference({ bytes, simd: true, cache: false, planar: true });
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [], sampleRate = 48000, frames = sampleRate * 30;
const source = Array.from({ length: 6 }, (_, channel) => Float32Array.from({ length: frames }, (_, i) =>
  0.1 * Math.sin(2 * Math.PI * (440 + channel * 113) * i / sampleRate)));
for (const channelCount of [1, 2, 4, 6]) for (const chunk of [128, 512, 1024, 4096]) for (const rate of [0.5, 1.25, 2]) {
  const planes = source.slice(0, channelCount);
  const timings = { jsInterleave: [], nativePlanar: [], allNative: [] };
  for (let repetition = 0; repetition < 7; repetition++) for (const kind of repetition % 2
    ? ['allNative', 'nativePlanar', 'jsInterleave'] : ['jsInterleave', 'nativePlanar', 'allNative']) {
    const start = process.cpuUsage(), processor = createTempoProcessor(kind === 'nativePlanar' ? current : kind === 'allNative' ? allNative : reference, sampleRate, rate);
    let count = 0, checksum = 0;
    for (let offset = 0; offset < frames; offset += chunk) {
      const input = planes.map(plane => plane.subarray(offset, offset + chunk));
      const stereo = kind === 'jsInterleave' ? downmixStereo(input) : null;
      const output = kind === 'jsInterleave' ? processor.push(stereo[0], stereo[1]) : processor.pushChannels(input);
      if (output) { count += output.length / 2; checksum += output[output.length >> 1]; }
    }
    const tail = processor.finish(); if (tail) { count += tail.length / 2; checksum += tail[tail.length >> 1]; }
    processor.dispose();
    const cpu = process.cpuUsage(start), elapsed = (cpu.user + cpu.system) / 1000;
    if (count !== Math.round(frames / rate) || !Number.isFinite(checksum)) throw new Error('Invalid planar benchmark output.');
    if (repetition >= 2) timings[kind].push(elapsed);
  }
  const row = { channels: channelCount, chunk, rate, jsInterleaveMs: median(timings.jsInterleave), nativePlanarMs: median(timings.nativePlanar), allNativeMs: median(timings.allNative) };
  row.speedup = row.jsInterleaveMs / row.nativePlanarMs;
  row.allNativeSpeedup = row.jsInterleaveMs / row.allNativeMs; rows.push(row);
}
const result = { runtime: process.version, cpu: cpus()[0]?.model, metric: 'process CPU milliseconds, complete adapters',
  sampleRate, sourceSeconds: 30, measuredRepetitions: 5, warmupRepetitions: 2,
  selectedPolicy: 'direct JS stores for mono/stereo, fused native speaker mix/interleave for quad/5.1',
  binarySha256: createHash('sha256').update(bytes).digest('hex'),
  adapterSha256: createHash('sha256').update(await readFile(new URL('../../../site/play/vendor/soundtouch/soundtouch.js', import.meta.url))).digest('hex'),
  referenceSha256: createHash('sha256').update(await readFile(new URL('./Js-interleave-reference.mjs', import.meta.url))).digest('hex'), rows };
await mkdir(new URL('../../../work/soundtouch/', import.meta.url), { recursive: true });
await writeFile(new URL('../../../work/soundtouch/planar-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
