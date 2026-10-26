// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NetEqRuntime } from '../../site/play/neteq.js';
import { NetEqAudio } from '../../site/play/neteq-audio.js';
const opus = JSON.parse(readFileSync(new URL('./fixtures/neteq-opus.json', import.meta.url))).packets.map(x => Uint8Array.from(Buffer.from(x, 'base64')));
const sine = (rate, first, length, channels = 1) => Int16Array.from({ length: length * channels }, (_, i) => Math.round(10000 * Math.sin((first + Math.floor(i / channels)) * Math.PI * 2 * 997 / rate)));

test('official WASM decodes Opus, recognizes FEC, and conceals a deliberately missing packet', () => {
  const stream = new NetEqRuntime().create('opus', 1), out = new Float32Array(480);
  let energy = 0;
  try {
    for (let tick = 0; tick < 220; tick++) {
      const packet = tick / 2;
      if (Number.isInteger(packet) && packet < opus.length && packet !== 30)
        assert.ok(stream.insert(opus[packet], packet, packet * 960, tick * 10));
      stream.pull(out, tick * 10); energy += out.reduce((sum, x) => sum + x * x, 0);
    }
    const stats = stream.stats();
    assert.ok(energy > 1); assert.ok(stats.fecPacketsReceived > 0);
    assert.ok(stats.concealedSamples > 0); assert.ok(stats.concealmentEvents > 0);
    assert.ok(Number.isFinite(stats.targetDelayMs));
  } finally { stream.dispose(); }
});

test('48 kHz PCM input and output drain, release exact credit, and preserve the tone frequency', () => {
  for (const rate of [48000]) for (const outputRate of [48000]) {
    let released = 0;
    const stream = new NetEqAudio(new NetEqRuntime(), rate, 2, outputRate, bytes => released += bytes, {});
    const pcm = sine(rate, 0, rate / 2, 2);
    try {
      stream.push({ pcm: pcm.buffer, arrivalLocalTimeMs: 0, generation: 1 }, 0); stream.finish();
      let crossings = 0, previous = 0, energy = 0, measured = 0;
      for (let block = 0; block < 300; block++) {
        const output = new Float32Array(256);
        stream.render(output, 128, block * 128000 / outputRate);
        if (block > 20 && block < 100) for (let i = 0; i < 128; i++) {
          const value = output[i * 2]; if (previous < 0 && value >= 0) crossings++;
          previous = value; energy += value * value; measured++;
          assert.equal(output[i * 2], output[i * 2 + 1]);
        }
      }
      assert.ok(energy > 10); assert.ok(Math.abs(crossings * outputRate / measured - 997) < 15);
      assert.equal(stream.state, 'ended'); assert.equal(released, pcm.byteLength);
    } finally { stream.clear(); }
  }
});

test('384ms PCM bursts use NetEq automatic time stretching without a video or source clock', () => {
  const stream = new NetEqAudio(new NetEqRuntime(), 48000, 1, 48000, () => {}, {});
  let next = 0, nonzero = 0;
  try {
    for (let block = 0; block < 4500; block++) {
      const time = block * 128 / 48;
      while (next * 384 <= time) {
        const pcm = sine(48000, next * 18432, 18432);
        stream.push({ pcm: pcm.buffer, decodeTimestampUs: next * 384000, arrivalLocalTimeMs: time }, time); next++;
      }
      const output = new Float32Array(128); stream.render(output, 128, time);
      if (output.some(value => Math.abs(value) > .01)) nonzero++;
    }
    const stats = stream.stats();
    assert.ok(nonzero > 4000); assert.ok(stats.insertedSamples + stats.removedSamples > 0);
    assert.ok(stats.queueBytes < 1024 * 1024); assert.ok(stats.targetDelayMs > 0);
  } finally { stream.clear(); }
});

test('Opus frame duration comes from the actual packet and source gaps do not become contiguous PCM', () => {
  let released = 0;
  const stream = new NetEqAudio(new NetEqRuntime(), 48000, 1, 48000, bytes => released += bytes, { codec: 'opus' });
  try {
    stream.push({ payload: opus[0].slice().buffer, decodeTimestampUs: 0, arrivalLocalTimeMs: 0 }, 0);
    assert.equal(stream.endFrame, 960);
    stream.push({ payload: opus[2].slice().buffer, decodeTimestampUs: 40000, arrivalLocalTimeMs: 40 }, 40);
    assert.equal(stream.endFrame, 2880);
    stream.finish();
    for (let block = 0; block < 100; block++) stream.render(new Float32Array(128), 128, block * 128 / 48);
    assert.equal(stream.state, 'ended'); assert.equal(released, opus[0].length + opus[2].length);
  } finally { stream.clear(); }
});

test('encoded Opus reordering is delegated to NetEq rather than rejected by the block adapter', () => {
  let released = 0;
  const stream = new NetEqAudio(new NetEqRuntime(), 48000, 1, 48000, bytes => released += bytes, { codec: 'opus' });
  try {
    for (const index of [0, 2, 1, 3]) stream.push({ payload: opus[index].slice().buffer,
      decodeTimestampUs: index * 20000, arrivalLocalTimeMs: 0 }, 0);
    assert.equal(stream.tokens.length, 4); assert.equal(released, 0);
    stream.finish();
    for (let block = 0; block < 100; block++) stream.render(new Float32Array(128), 128, block * 128 / 48);
    assert.equal(stream.state, 'ended'); assert.equal(released, opus.slice(0, 4).reduce((n, p) => n + p.length, 0));
  } finally { stream.clear(); }
});

test('finite PCM tails shorter than 10 ms render in mono and stereo and return only source credit', () => {
  for (const channels of [1, 2]) for (const frames of [1, 479, 481, 512, 1024, 5573]) {
    let released = 0;
    const stream = new NetEqAudio(new NetEqRuntime(), 48000, channels, 48000, bytes => released += bytes, {});
    const pcm = sine(48000, 0, frames, channels);
    try {
      stream.push({ pcm: pcm.buffer, decodeTimestampUs: 0, arrivalLocalTimeMs: 0 }, 0);
      stream.finish();
      assert.equal(stream.endFrame, frames, 'padding must not extend the source timeline');
      for (let block = 0; block < 200 && stream.state !== 'ended'; block++) {
        const output = new Float32Array(128 * channels);
        stream.render(output, 128, block * 128 / 48);
        assert.ok(output.every(Number.isFinite));
      }
      assert.equal(stream.state, 'ended', `${channels} channels, ${frames} source frames`);
      assert.equal(released, pcm.byteLength, 'padding must not create extra byte credit');
      assert.equal(stream.queueBytes, 0);
    } finally { stream.clear(); }
  }
});

test('a partial PCM block before a timestamp gap retains the gap and renders through EOS', () => {
  const stream = new NetEqAudio(new NetEqRuntime(), 48000, 2, 48000, () => {}, {});
  try {
    stream.push({ pcm: sine(48000, 0, 512, 2).buffer, decodeTimestampUs: 0, arrivalLocalTimeMs: 0 }, 0);
    stream.push({ pcm: sine(48000, 4800, 512, 2).buffer, decodeTimestampUs: 100000, arrivalLocalTimeMs: 0 }, 0);
    assert.equal(stream.endFrame, 5312, 'source gap must not become contiguous PCM');
    stream.finish();
    for (let block = 0; block < 300 && stream.state !== 'ended'; block++)
      stream.render(new Float32Array(256), 128, block * 128 / 48);
    assert.equal(stream.state, 'ended');
  } finally { stream.clear(); }
});
