import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempoProcessor, downmixStereo } from '../../site/play/airplay-tempo.js';
import { SoundTouchCore } from '../../site/play/vendor/mediabunny/mediabunny.min.js';

test('speaker downmix preserves 5.1 dialogue and surround, omits LFE, and rejects undefined layouts', () => {
  const channel = value => Float32Array.of(value);
  const mono = [channel(0.3)]; assert.equal(downmixStereo(mono)[1], mono[0]);
  const stereo = [channel(0.2), channel(0.3)]; assert.equal(downmixStereo(stereo), stereo);
  const quad = downmixStereo([channel(0.2), channel(0.4), channel(0.6), channel(0.8)]);
  assert.ok(Math.abs(quad[0][0] - 0.4) < 0.00001); assert.ok(Math.abs(quad[1][0] - 0.6) < 0.00001);
  const centreOnly = downmixStereo([channel(0), channel(0), channel(1), channel(100), channel(0), channel(0)]);
  assert.ok(Math.abs(centreOnly[0][0] - Math.SQRT1_2) < 0.00001);
  assert.ok(Math.abs(centreOnly[1][0] - Math.SQRT1_2) < 0.00001);
  const surround = downmixStereo([channel(0), channel(0), channel(0), channel(100), channel(1), channel(0.5)]);
  assert.ok(Math.abs(surround[0][0] - Math.SQRT1_2) < 0.00001);
  assert.ok(Math.abs(surround[1][0] - Math.SQRT1_2 * 0.5) < 0.00001);
  for (const count of [3, 5, 7, 8]) assert.throws(() => downmixStereo(Array.from({ length: count }, () => channel(0))), { name: 'NotSupportedError' });
});

test('continuous WSOLA changes duration while preserving a 440 Hz tone at half and double speed', () => {
  const sampleRate = 44100, frames = sampleRate * 2;
  for (const rate of [0.5, 2]) {
    const processor = createTempoProcessor(SoundTouchCore, sampleRate, rate), blocks = [];
    for (let offset = 0; offset < frames; offset += 1024) {
      const signal = Float32Array.from({ length: Math.min(1024, frames - offset) }, (_, i) => Math.sin(2 * Math.PI * 440 * (offset + i) / sampleRate));
      const block = processor.push(signal); if (block) blocks.push(block);
    }
    const tail = processor.finish(); if (tail) blocks.push(tail);
    const output = new Float32Array(blocks.reduce((length, block) => length + block.length, 0));
    let offset = 0;
    for (const block of blocks) { output.set(block, offset); offset += block.length; }
    assert.ok(Math.abs(output.length / 2 - frames / rate) < sampleRate * 0.01, 'flush trims padded lookahead to the source duration');
    const begin = Math.round(output.length / 8), end = Math.round(output.length * 3 / 8);
    let crossings = 0;
    for (let i = begin * 2; i < end * 2 - 2; i += 2) if (output[i] <= 0 && output[i + 2] > 0) crossings++;
    const frequency = crossings / ((end - begin) / sampleRate);
    assert.ok(Math.abs(frequency - 440) < 12, `tempo ${rate} retains pitch, observed ${frequency} Hz`);
  }
});
