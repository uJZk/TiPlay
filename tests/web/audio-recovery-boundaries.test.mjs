// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { constantDelay } from '../../site/play/delay-plan.js';

const EPSILON_MS = 2 ** -20;
const runtime = new SoxrRuntime();
const waveform = frame => Math.round(12000 * Math.sin(frame * 2 * Math.PI * 997 / 48000));

test('non-catch-up Soxr playback retains the ±30ms recovery boundary', () => {
  for (const sign of [-1, 1]) for (const magnitude of [30 - EPSILON_MS, 30, 30 + EPSILON_MS]) {
    const player = new ContinuousAudio(runtime, 48000, 1, 48000, () => {}, 6500, { mode: 'airplay-mirror' });
    const clock = { generation: 1, rate: 1, state: 'locked' }, output = new Float32Array(128);
    for (let frame = 0; frame < 48000; frame += 960) player.push({
      pcm: Int16Array.from({ length: 960 }, (_, i) => waveform(frame + i)).buffer,
      sequence: frame / 960, presentationMs: 800000 + frame / 48, arrivalLocalTimeMs: frame / 48,
    }, 1);
    try {
      player.render(800100, 0, clock, 128, output);
      assert.ok(player.backend); const backend = player.backend, cursor = player.rawCursorMs;
      player.render(cursor + sign * magnitude, 128 / 48, clock, 128, output);
      assert.equal(player.recoveryCounts['clock-step'] || 0, magnitude > 30 ? 1 : 0);
      if (magnitude <= 30) {
        assert.equal(player.backend, backend, 'a legal phase correction cannot recreate the running polyphase filter');
        assert.ok(output.some(sample => Math.abs(sample) > .1));
      } else {
        assert.notEqual(player.backend, backend);
        assert.ok(Math.abs(player.lastClockStep.phaseErrorMs - sign * magnitude) < 1e-8);
      }
      assert.ok(output.every(Number.isFinite));
    } finally { player.clear(); }
  }
});

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

test('the production worklet retains changes below 8ms and applies changes with recovery at exactly ±8ms', () => {
  for (const sign of [-1, 1]) for (const magnitude of [8 - EPSILON_MS, 8, 8 + EPSILON_MS]) {
    const processor = new Processor(), sourceBase = 800000;
    let frame = 0, inputFrame = 0;
    const post = data => processor.port.onmessage({ data });
    post({ calibration: { rate: 48000, outputRate: 48000, delayMs: runtime.filterDelay(48000, 48000) } });
    post({ clock: { generation: 1, serverOriginMs: sourceBase, localOriginMs: 0, rate: 1, state: 'locked', uncertaintyMs: 0 },
      contextAnchor: { contextTimeMs: 0, localTimeMs: 200 }, outputUncertaintyMs: 1,
      plans: { audio: constantDelay(60), video: constantDelay(0) } });
    const render = () => {
      globalThis.currentTime = frame / 48000; globalThis.currentFrame = frame;
      while (inputFrame < frame + 19200) {
        post({ type: 0, semanticType: 0, mode: 'carplay', epoch: 1, generation: 1, rate: 48000, channels: 1,
          sequence: inputFrame / 960, flags: 0, presentationMs: sourceBase + inputFrame / 48,
          arrivalLocalTimeMs: frame / 48, pcm: Int16Array.from({ length: 960 }, (_, i) => waveform(inputFrame + i)).buffer });
        inputFrame += 960;
      }
      const output = [new Float32Array(128), new Float32Array(128)];
      processor.process([], [output]); frame += 128;
      assert.ok(output.every(channel => channel.every(Number.isFinite))); return output;
    };
    try {
      for (let i = 0; i < 50; i++) render();
      const player = processor.timelines.get(0), backend = player.backend;
      assert.ok(backend); assert.equal(player.networkDelayMs, 60);
      post({ plans: { audio: constantDelay(60 + sign * magnitude), video: constantDelay(0) } });
      const output = render();
      const applied = magnitude >= 8;
      assert.equal(player.networkDelayMs, applied ? 60 + sign * magnitude : 60);
      assert.equal(player.recoveryCounts['network-buffer'] || 0, applied ? 1 : 0);
      if (!applied) {
        assert.equal(player.backend, backend);
        assert.ok(output[0].some(sample => Math.abs(sample) > .1));
      } else assert.notEqual(player.backend, backend, 'an accepted network-target step retires the old output signal once');
      for (let i = 0; i < 8; i++) render();
      assert.equal(player.recoveryCounts['network-buffer'] || 0, applied ? 1 : 0, 'an unchanged accepted target cannot cause repeated recoveries');
      assert.ok(player.backend, 'a bounded 8ms target change must reacquire from buffered real PCM');
    } finally { post({ dispose: true }); }
  }
});
