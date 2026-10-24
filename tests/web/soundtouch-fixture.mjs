import { readFile } from 'node:fs/promises';
import { loadSoundTouch } from '../../site/play/vendor/soundtouch/soundtouch.js';

export const soundTouch = await loadSoundTouch({
  bytes: await readFile(new URL('../../site/play/vendor/soundtouch/soundtouch.simd.wasm', import.meta.url)),
});
