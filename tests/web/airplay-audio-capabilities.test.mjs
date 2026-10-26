import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMirrorAudioFormats } from '../../site/play/airplay-capabilities.js';
test('negotiation includes software ALAC, AAC-LC and ELD without consulting WebCodecs', async () => {
  const Decoder = { isConfigSupported() { throw Error('Native audio probes must not run'); } };
  const formats = await probeMirrorAudioFormats(Decoder);
  for (let bit = 2; bit <= 25; bit++) assert.ok(formats & (1 << bit));
  assert.equal(formats & 3, 0);
});
