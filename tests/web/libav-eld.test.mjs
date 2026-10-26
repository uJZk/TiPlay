// Decode actual synthetic ELD access units using both shipped WASM variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibav, libavAudioParameters } from '../../site/play/vendor/libav/libav.js';
import { loadFixtures } from '../bench/libav/fixtures.mjs';

test('explicit audio codec type fixes all eight ELD profiles in both WASM builds', async () => {
  const fixtures = (await loadFixtures()).filter(f => f.name.includes('ELD'));
  assert.equal(fixtures.length, 8);
  for (const simd of [false, true]) {
    const { instance: lib } = await createLibav({ simd });
    for (const fixture of fixtures) {
      const framesPerPacket = Number(fixture.name.split(' ').at(-1));
      for (const fixed of [false, true]) {
        const codecpar = libavAudioParameters(fixture.rate, fixture.channels, fixture.asc);
        if (!fixed) delete codecpar.codec_type;
        const [, context, packet, frame] = lib.ff_init_decoder('aac', { codecpar, time_base: [1, fixture.rate] });
        try {
          assert.equal(lib.AVCodecContext_sample_rate(context), fixed ? fixture.rate : 0);
          if (!fixed) {
            assert.throws(() => lib.ff_decode_multi(context, packet, frame,
              [{ data: fixture.packets[0], pts: 0, ptshi: 0, dts: 0, dtshi: 0 }], false), /Internal bug/);
            continue;
          }
          let total = 0, peak = 0;
          for (let i = 0; i < fixture.packets.length; i++) {
            const pts = i * framesPerPacket;
            const outputs = lib.ff_decode_multi(context, packet, frame,
              [{ data: fixture.packets[i], pts, ptshi: 0, dts: pts, dtshi: 0 }], false);
            assert.equal(outputs.length, 1, fixture.name);
            const output = outputs[0];
            assert.equal(output.sample_rate, fixture.rate);
            assert.equal(output.channels, fixture.channels);
            assert.equal(output.nb_samples, framesPerPacket);
            for (const plane of output.data) for (const value of plane) {
              assert.ok(Number.isFinite(value));
              peak = Math.max(peak, Math.abs(value));
            }
            total += output.nb_samples;
          }
          assert.equal(total, 12 * framesPerPacket);
          assert.ok(peak > .001, fixture.name);
          assert.equal(lib.ff_decode_multi(context, packet, frame, [], true).length, 0);
        } finally { lib.ff_free_decoder(context, packet, frame); }
      }
    }
  }
});
