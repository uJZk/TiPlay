// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';
import { createTimedFrames } from '../../site/play/media-timing.js';
import { constantDelay } from '../../site/play/delay-plan.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

test('independent slow output clock keeps real worklet audio and CarPlay video synchronized', async () => {
  const globals = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const saved = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const origin = 1_800_000_000_000, sourceOrigin = 800000, rate = 48000, deviceRate = 0.996;
  const outputLatencyMs = 188, audioDelayMs = 60, durationMs = 45000;
  let Processor, contextFrames = 480000, elapsed = 0, inputFrame = 0, sequence = 0, nextVideoMs = 0;
  let output, draws = 0, minimumEnergy = Infinity, maximumSkew = -Infinity, minimumSkew = Infinity;
  let timerId = 0, lastControlsMs = -Infinity;
  const timers = new Map(), references = [];
  const now = () => origin + 10000 + elapsed;
  const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  define('sampleRate', rate);
  Object.defineProperty(globalThis, 'currentTime', { configurable: true, get: () => contextFrames / rate });
  define('AudioWorkletProcessor', class { constructor() { this.port = { postMessage: data => { if (data.playout) references.push(data.playout); } }; } });
  define('registerProcessor', (_name, implementation) => { Processor = implementation; });
  const context = { state: 'running', sampleRate: rate,
    get currentTime() { return contextFrames / rate; },
    getOutputTimestamp() { return { contextTime: this.currentTime - outputLatencyMs * deviceRate / 1000, performanceTime: 10000 + elapsed }; } };
  const mapping = createAudioOutputMapping({ now, timeOrigin: () => origin });
  const frames = createTimedFrames((frame, _config, _id, timing, window) => {
    const skew = window.audioAt - now();
    minimumSkew = Math.min(minimumSkew, skew); maximumSkew = Math.max(maximumSkew, skew);
    assert.ok(now() <= timing + 0.001, 'the zero CarPlay mode cap stays unchanged');
    assert.ok(skew >= -45.001 && skew <= 125.001, 'actual audible output stays inside the existing A/V window');
    draws++; frame.close();
  }, { now, schedule(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now() + delay }); return id; },
    cancel: id => timers.delete(id) });
  function advance(targetElapsed) {
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= origin + 10000 + targetElapsed)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); elapsed = due[1].at - origin - 10000; due[1].callback();
    }
    elapsed = targetElapsed;
  }
  try {
    await import('../../site/play/audio-worklet.js?video-device-clock');
    output = new Processor();
    const post = data => output.port.onmessage({ data });
    const calibration = new SoxrRuntime();
    post({ calibration: { rate, outputRate: rate, delayMs: calibration.filterDelay(rate, rate) } });
    post({ prepare: { id: 1, rate, outputRate: rate } });
    frames.delay(constantDelay(0));
    for (let quantum = 0; elapsed < durationMs; quantum++) {
      if (elapsed - lastControlsMs >= 20) {
        lastControlsMs = elapsed;
        const anchor = mapping.capture(context);
        post({ clock: { version: 2, generation: 1, rate: 1, state: 'tracking', serverOriginMs: sourceOrigin, localOriginMs: 10000 },
          deviceClock: mapping.deviceClock(), contextAnchor: { contextTimeMs: anchor.contextTimeMs, localTimeMs: anchor.performanceTimeMs - origin },
          localTimeOriginMs: origin, plans: { video: constantDelay(0), audio: constantDelay(audioDelayMs) } });
      }
      while (inputFrame / 48 < elapsed + 2000) {
        const pcm = Int16Array.from({ length: 2048 }, (_, sample) => {
          const frame = inputFrame + Math.floor(sample / 2);
          return Math.round(15000 * Math.sin(frame * 2 * Math.PI * 997 / rate) + 3000 * Math.cos(frame * 2 * Math.PI * 137 / rate));
        });
        post({ type: 0, semanticType: 0, mode: 'carplay', epoch: 1, generation: 1, rate, channels: 2, flags: 1,
          sequence: sequence++, presentationMs: sourceOrigin + inputFrame / 48, pcm: pcm.buffer });
        inputFrame += 1024;
      }
      const block = [new Float32Array(128), new Float32Array(128)];
      assert.equal(output.process([], [block]), true);
      contextFrames += 128;
      advance((quantum + 1) * 128000 / rate / deviceRate);
      for (const feedback of references.splice(0)) frames.audio(mapping.reference(feedback, context));
      if (elapsed > 10000) minimumEnergy = Math.min(minimumEnergy, block[0].reduce((total, sample) => total + sample * sample, 0));
      if (elapsed >= nextVideoMs) {
        nextVideoMs += 1000 / 30;
        frames.present({ close() {} }, { mode: 'carplay', epoch: 1 }, 1, now() + 40,
          { sourceTimeMs: sourceOrigin + elapsed + 40, clockGeneration: 1 });
      }
    }
    advance(durationMs + 100);
    const audio = output.timelines.get(0);
    assert.ok(draws >= 1340, 'at least 99% of supplied video remains presentable during clock fitting and sustained drift');
    assert.equal(audio.recoveryCounts['clock-step'], undefined, 'the device rate must not repeatedly cross the phase reset threshold');
    assert.ok(minimumEnergy > 8, 'dynamic PCM remains audible without reset fades');
    assert.ok(Math.abs(mapping.deviceClock().rate - deviceRate) < 0.00001);
    assert.equal(frames.stats().audioSyncUnavailableFrames, 0);
    assert.ok(minimumSkew >= -45.001 && maximumSkew <= 125.001);
  } finally {
    frames.reset(); output?.port.onmessage({ data: { dispose: true } });
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
