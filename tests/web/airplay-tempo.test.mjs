import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempoProcessor, downmixStereo } from '../../site/play/airplay-tempo.js';
import { soundTouch } from './soundtouch-fixture.mjs';
import { readFile } from 'node:fs/promises';
import { loadSoundTouch } from '../../site/play/vendor/soundtouch/soundtouch.js';

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
    const processor = createTempoProcessor(soundTouch, sampleRate, rate), blocks = [];
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

test('portable and SIMD engines flush short streams exactly and isolate independent stereo processors', async () => {
  const sampleRate = 48000;
  for (const filename of ['soundtouch.wasm', 'soundtouch.simd.wasm']) {
    const core = await loadSoundTouch({ bytes: await readFile(new URL(`../../site/play/vendor/soundtouch/${filename}`, import.meta.url)), simd: filename.includes('.simd.'), cache: false });
    for (const rate of [0.25, 0.5, 1.25, 2, 4]) {
      const processor = createTempoProcessor(core, sampleRate, rate);
      const frames = 4800, blocks = [];
      for (let offset = 0; offset < frames; offset += 127) {
        const left = Float32Array.from({ length: Math.min(127, frames - offset) }, (_, i) =>
          Math.sin(2 * Math.PI * 440 * (offset + i) / sampleRate));
        const samples = processor.push(left, new Float32Array(left.length));
        if (samples) blocks.push(samples);
      }
      const tail = processor.finish(); if (tail) blocks.push(tail);
      assert.equal(blocks.reduce((count, block) => count + block.length / 2, 0), Math.round(frames / rate));
      let energy = 0;
      for (const block of blocks) for (let i = 0; i < block.length; i += 2) {
        assert.ok(Number.isFinite(block[i])); energy += block[i] * block[i];
        assert.equal(block[i + 1], 0, 'the silent channel must remain silent');
      }
      assert.ok(energy > 1, `${filename} at ${rate}x must retain audible source samples`);
      assert.equal(processor.finish(), null);
      processor.dispose();
      assert.throws(() => processor.push(new Float32Array(1)), /closed/);
    }
    const a = createTempoProcessor(core, sampleRate, 0.5), b = createTempoProcessor(core, sampleRate, 2);
    const signal = new Float32Array(4800).fill(0.5);
    a.push(signal); b.push(new Float32Array(signal.length));
    const aTail = a.finish(), bTail = b.finish();
    assert.ok(aTail.some(value => value > 0.1));
    assert.ok(bTail.every(value => value === 0));
  }
});

test('native original-plane submission preserves Web Audio quad/5.1 speaker mapping and float headroom', () => {
  const render = (channels, planar) => {
    const processor = createTempoProcessor(soundTouch, 48000, 1.25);
    const stereo = planar ? null : downmixStereo(channels);
    const blocks = [planar ? processor.pushChannels(channels) : processor.push(stereo[0], stereo[1]), processor.finish()].filter(Boolean);
    const samples = new Float32Array(blocks.reduce((length, block) => length + block.length, 0));
    let offset = 0;
    for (const block of blocks) { samples.set(block, offset); offset += block.length; }
    return samples;
  };
  for (const count of [4, 6]) for (let active = 0; active <= count; active++) {
    // Isolate every speaker, including 5.1 LFE, then exercise unclipped headroom.
    const channels = Array.from({ length: count }, (_, channel) => new Float32Array(8357).fill(active === count ? 2 : channel === active ? 0.5 : 0));
    const actual = render(channels, true), expected = render(channels, false);
    assert.equal(actual.length, expected.length);
    let peak = 0;
    for (let i = 0; i < actual.length; i++) {
      assert.ok(Number.isFinite(actual[i]));
      assert.ok(Math.abs(actual[i] - expected[i]) < 0.00001, `${count} channel speaker ${active}, output ${i}`);
      peak = Math.max(peak, Math.abs(actual[i]));
    }
    if (count === 6 && active === 3) assert.equal(peak, 0, 'LFE is omitted by the speaker mapping');
    if (active === count) assert.ok(peak > 1, 'native downmix retains floating-point headroom');
  }
  const processor = createTempoProcessor(soundTouch, 48000, 2);
  assert.throws(() => processor.pushChannels(Array.from({ length: 3 }, () => new Float32Array(4))), { name: 'NotSupportedError' });
  assert.throws(() => processor.pushChannels([new Float32Array(2), new Float32Array(3)]), TypeError);
  processor.dispose();
});

test('URL initial and dynamic tempo agree in portable and SIMD WASM', async () => {
  for (const filename of ['soundtouch.wasm', 'soundtouch.simd.wasm']) {
    const bytes = await readFile(new URL(`../../site/play/vendor/soundtouch/${filename}`, import.meta.url));
    const api = new WebAssembly.Instance(await WebAssembly.compile(bytes), { wasi_snapshot_preview1: {
      fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8, random_get: () => 52,
    } }).exports;
    api._initialize();
    const pointer = api.malloc(4096 * 2 * 4);
    const view = () => new Float32Array(api.memory.buffer, pointer, 8192);
    try {
      for (const rate of [.2, .25, .5, .95, 1, 1.2, 2, 4, 4.8]) {
        const handles = [api.tempo_create(48000, rate), api.tempo_create(48000, 1)];
        try {
          assert.ok(handles.every(Boolean));
          assert.equal(api.tempo_set(handles[1], rate), 1);
          for (const invalid of [.199, 4.801, NaN, Infinity]) assert.equal(api.tempo_set(handles[1], invalid), 0);
          const outputs = handles.map(handle => {
            const samples = [];
            const drain = () => {
              while (api.tempo_available(handle)) {
                const count = api.tempo_receive(handle, pointer, 4096);
                assert.ok(count > 0);
                samples.push(...view().subarray(0, count * 2));
              }
            };
            for (let first = 0; first < 9600; first += 128) {
              view().set(Float32Array.from({ length: 256 }, (_, i) => Math.sin((first + Math.floor(i / 2)) * .13) * .3));
              api.tempo_put(handle, pointer, 128); drain();
            }
            api.tempo_finish(handle); drain();
            return samples;
          });
          assert.equal(outputs[0].length / 2, Math.round(9600 / rate));
          assert.deepEqual(outputs[0], outputs[1], `${filename}: ${rate}x cannot select a different WSOLA policy`);
        } finally { for (const handle of handles) if (handle) api.tempo_delete(handle); }
      }
    } finally { api.free(pointer); }
  }
});
