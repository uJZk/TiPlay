// SPDX-License-Identifier: GPL-3.0-only
// Node has no file: fetch. Load the exact shipped binaries before synchronous
// processor fixtures; production compiles these modules before creating a node.
import { readFile } from 'node:fs/promises';
import { prepareSoxr } from '../../site/play/streaming-resampler.js';
import { prepareAudioCore } from '../../site/play/wasm/audio-core.js';

await Promise.all([
  ['vendor/soxr/soxr.wasm', prepareSoxr], ['wasm/audio-core.wasm', prepareAudioCore],
].map(async ([path, prepare]) => prepare(await WebAssembly.compile(
  await readFile(new URL(`../../site/play/${path}`, import.meta.url))))));
