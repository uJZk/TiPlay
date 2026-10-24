// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmTimeline } from '../../site/play/pcm-timeline.js';
import { constantDelay } from '../../site/play/delay-plan.js';

function waveform(frames, rate, channels) {
  const pcm = new Int16Array(frames * channels);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const phase = frame * 2 * Math.PI / rate;
    pcm[frame * channels + channel] = Math.round(32767 * (
      0.55 * Math.sin(phase * (channel ? 2171 : 997) + 0.13)
      + 0.15 * Math.sin(phase * 4013 + 0.87)));
  }
  return pcm;
}

test('packetizing a continuous waveform preserves stereo interpolation at fractional output times', () => {
  const packetFrames = 1024, packetCount = 8;
  for (const base of [0, 1792159881151.6]) for (const [rate, outputRate, channels] of [
    [48000, 48000, 2], [44100, 48000, 2], [48000, 44100, 2], [16000, 48000, 1],
  ]) for (const phase of [0, 0.25, 0.73]) {
    const all = waveform(packetFrames * packetCount, rate, channels), credits = [];
    const split = new PcmTimeline(rate, channels, (bytes, reason) => credits.push({ bytes, reason }));
    const whole = new PcmTimeline(rate, channels, () => {});
    whole.push({ sourceTime: base, sequence: 0, pcm: all.buffer });
    for (let sequence = 0; sequence < packetCount; sequence++) {
      split.push({ sourceTime: base + sequence * packetFrames * 1000 / rate, sequence,
        pcm: all.slice(sequence * packetFrames * channels, (sequence + 1) * packetFrames * channels).buffer });
    }
    let maximumError = 0;
    const outputFrames = Math.floor((all.length / channels - 2) * outputRate / rate);
    for (let frame = 0; frame < outputFrames; frame++) {
      const at = base + (frame + phase) * 1000 / outputRate;
      for (let channel = 0; channel < channels; channel++) {
        const expected = whole.sample(at, channel), actual = split.sample(at, channel);
        maximumError = Math.max(maximumError, Math.abs(actual - expected));
        assert.ok(actual !== 0 || Math.abs(expected) < 0.02, 'packet boundaries cannot insert a silent sample into the waveform');
      }
    }
    // Epoch-millisecond arithmetic has less than one source sample of precision. The
    // reference and partitioned queue may round differently, without a packet-end step.
    assert.ok(maximumError < (base ? 0.008 : 1e-8),
      `packetization changed the waveform: rate=${rate}, outputRate=${outputRate}, channels=${channels}, phase=${phase}, base=${base}, error=${maximumError}`);
    split.sample(base + all.length / channels * 1000 / rate + 1, 0);
    assert.deepEqual(credits, Array.from({ length: packetCount }, () => ({ bytes: packetFrames * channels * 2, reason: 'played' })));
  }
});

test('boundary interpolation waits for a contiguous packet and preserves its consumption credit', () => {
  const rate = 48000, channels = 2, frames = 16, base = 1792159881151.6, credits = [];
  const all = waveform(frames * 2, rate, channels), audio = new PcmTimeline(rate, channels, (bytes, reason) => credits.push({ bytes, reason }));
  const end = base + frames * 1000 / rate, at = base + (frames - 0.5) * 1000 / rate;
  audio.push({ sourceTime: base, sequence: 0, pcm: all.slice(0, frames * channels).buffer });
  for (let channel = 0; channel < channels; channel++) {
    assert.equal(audio.sample(at, channel), all[(frames - 1) * channels + channel] / 32768, 'an unavailable packet is never read');
  }
  audio.push({ sourceTime: end, sequence: 1, pcm: all.slice(frames * channels).buffer });
  const fraction = (at - base) * rate / 1000 - (frames - 1);
  for (let channel = 0; channel < channels; channel++) {
    const left = all[(frames - 1) * channels + channel], right = all[frames * channels + channel];
    assert.equal(audio.sample(at, channel), (left + (right - left) * fraction) / 32768);
  }
  assert.deepEqual(credits, [], 'looking at the following first frame cannot retire either packet');
  audio.sample(end, 0);
  assert.deepEqual(credits, [{ bytes: frames * channels * 2, reason: 'played' }]);
  audio.clear();
  assert.deepEqual(credits.at(-1), { bytes: frames * channels * 2, reason: 'reset' });
});

test('independently rounded contiguous timestamps do not insert a silent stereo sample', () => {
  const rate = 48000, frames = 1024, channels = 2, frameMs = frames * 1000 / rate;
  const all = waveform(frames * 2, rate, channels);
  for (const base of [0, 1792159881151.6]) {
    let start, end, next;
    for (let packet = 0; packet < 100; packet++) {
      start = base + packet * frameMs; end = start + frameMs; next = base + (packet + 1) * frameMs;
      if (next > end) break;
    }
    assert.ok(next > end, 'the test must exercise a boundary that rounds in different directions');
    const credits = [], audio = new PcmTimeline(rate, channels, (bytes, reason) => credits.push({ bytes, reason }));
    audio.push({ sourceTime: start, sequence: 0, pcm: all.slice(0, frames * channels).buffer });
    audio.push({ sourceTime: next, sequence: 1, pcm: all.slice(frames * channels).buffer });
    for (let channel = 0; channel < channels; channel++) {
      assert.ok(Math.abs(audio.sample(end, channel) - all[frames * channels + channel] / 32768) < (base ? 0.003 : 1e-12),
        'the rounding interval uses the continuous neighbor instead of silence');
    }
    assert.deepEqual(credits, [], 'both channels retain the same packet until the following start time');
    audio.sample(next, 0);
    assert.deepEqual(credits, [{ bytes: frames * channels * 2, reason: 'played' }]);
  }
});

test('interpolation never bridges a real timestamp gap or overlapping audio', () => {
  for (const base of [0, 1792159881151.6]) for (const gapFrames of [-0.5, 0.5, 1, 48]) {
    const rate = 48000, frames = 16, all = waveform(frames * 2, rate, 1), audio = new PcmTimeline(rate, 1, () => {});
    const end = base + frames * 1000 / rate;
    audio.push({ sourceTime: base, sequence: 0, pcm: all.slice(0, frames).buffer });
    audio.push({ sourceTime: end + gapFrames * 1000 / rate, sequence: 1, pcm: all.slice(frames).buffer });
    assert.equal(audio.sample(base + (frames - 0.75) * 1000 / rate, 0), all[frames - 1] / 32768,
      'a future or overlapping packet is not the adjacent sample of this waveform');
    if (gapFrames > 0) assert.equal(audio.sample(end, 0), 0, 'actual missing source time remains silent');
  }
});

test('worklet epoch and format changes retire the previous interpolation neighbor', async () => {
  const previous = Object.fromEntries(['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', 'currentFrame'].map(key => [key, globalThis[key]]));
  let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; } };
  globalThis.registerProcessor = (_, value) => { Processor = value; };
  globalThis.sampleRate = 48000;
  try {
    await import('../../site/play/audio-worklet.js');
    for (const changed of [{ epoch: 2 }, { rate: 44100 }, { channels: 1 }]) {
      const processor = new Processor(), base = 1792159881151.6, frames = 128;
      const post = data => processor.port.onmessage({ data });
      post({ clockBase: base, plans: { video: constantDelay(0), audio: constantDelay(0) } });
      const initial = { type: 0, mode: 'carplay', epoch: 1, sequence: 0, rate: 48000, channels: 2, flags: 0, generation: 1 };
      post({ ...initial, sourceTime: base, pcm: waveform(frames, 48000, 2).buffer });
      const next = { ...initial, sequence: 1, ...changed };
      post({ ...next, sourceTime: base + frames * 1000 / 48000, pcm: waveform(frames, next.rate, next.channels).buffer });
      assert.deepEqual(processor.messages.filter(value => value.consumed), [{ consumed: frames * 2 * 2, generation: 1 }]);
      globalThis.currentTime = (frames - 0.5) / 48000;
      globalThis.currentFrame = frames - 1;
      const output = [new Float32Array(128), new Float32Array(128)];
      processor.process([], [output]);
      assert.equal(output[0][0], 0); assert.equal(output[1][0], 0, 'retired PCM cannot interpolate into the replacement stream');
      assert.ok(output[0].slice(1).some(value => value !== 0), 'the replacement dynamic waveform still plays');
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
