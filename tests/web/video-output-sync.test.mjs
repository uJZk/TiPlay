// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimedFrames } from '../../site/play/media-timing.js';
import { createFramePresenter } from '../../site/play/video.js';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';
import { constantDelay } from '../../site/play/delay-plan.js';

function virtualClock(start = 1000) {
  let at = start, nextId = 0;
  const timers = new Map();
  return {
    now: () => at,
    schedule(callback, wait) { const id = ++nextId; timers.set(id, { at: at + wait, callback }); return id; },
    cancel: id => timers.delete(id),
    advance(target) {
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); at = due[1].at; due[1].callback();
      }
      at = target;
    },
  };
}
const picture = () => ({ close() { this.closed = true; } });
const ref = (extra = {}) => ({ mode: 'airplay-mirror', type: 0, epoch: 1, generation: 1, sequence: 1, clockGeneration: 1,
  state: 'playing', sourceTimeMs: 5000, audibleTimeMs: 1120, mediaRate: 1, at: 1000, uncertaintyMs: 0,
  outputMethod: 'timestamp', ...extra });

test('video follows actual audible output inside the AirPlay mirror cap', () => {
  const clock = virtualClock(), shown = [];
  const frames = createTimedFrames((frame, config, id, timing, window) => shown.push({ frame, timing, window, at: clock.now() }), clock);
  frames.delay(constantDelay(0)); frames.audio(ref());
  const frame = picture(); frames.present(frame, { mode: 'airplay-mirror' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
  clock.advance(1029); assert.equal(shown.length, 0);
  clock.advance(1030); assert.equal(shown.length, 1);
  assert.equal(shown[0].at, 1030, 'network video target is already inside the actual-output interval');
  assert.equal(shown[0].window.audioAt - shown[0].at, 90);
  assert.ok(shown[0].at <= 1050);
  frames.reset();
});

test('a repeated native output pair reserves drift error at the physical late125ms boundary', () => {
  const origin = 1700000000000, clock = virtualClock(origin + 10000), deviceRate = .996;
  const deviceLatency = 80, audioDelay = 110, sourceAt = time => 700000000 + time - origin;
  const mapping = createAudioOutputMapping({ now: clock.now, timeOrigin: () => origin });
  const nativePair = { contextTime: (10000 - deviceLatency) * deviceRate / 1000, performanceTime: 10000 };
  const context = { state: 'running', sampleRate: 48000, baseLatency: .012, outputLatency: .08,
    get currentTime() { return (clock.now() - origin) * deviceRate / 1000; }, getOutputTimestamp: () => nativePair };
  mapping.capture(context);
  clock.advance(clock.now() + 500);
  const producer = { at: clock.now(), sourceTimeMs: sourceAt(clock.now() + deviceLatency - audioDelay) };
  const reference = mapping.reference({ mode: 'airplay-mirror', type: 0, epoch: 1, generation: 1, sequence: 1,
    state: 'playing', contextTimeMs: context.currentTime * 1000, sourceTimeMs: producer.sourceTimeMs,
    mediaRate: 1 / deviceRate }, context);
  let draws = 0;
  const frames = createTimedFrames((frame, config, id, timing) => {
    const physicalAudioAt = producer.at + deviceLatency + sourceAt(timing) - producer.sourceTimeMs;
    const physicalSkew = physicalAudioAt - clock.now();
    assert.ok(physicalSkew >= -45 - .001 && physicalSkew <= 125 + .001,
      `a held native pair must not hide the real speaker skew ${physicalSkew}ms`);
    draws++; frame.close();
  }, clock);
  frames.delay(constantDelay(0)); frames.audio(reference);
  const timing = clock.now() + 30;
  frames.present(picture(), { mode: 'airplay-mirror' }, 1, timing, { sourceTimeMs: sourceAt(timing) });
  clock.advance(clock.now() + 99);
  assert.equal(draws, 1, 'bounded drift uncertainty still permits a feasible picture');
  assert.equal(reference.outputMethod, 'timestamp-holdover');
  assert.ok(reference.uncertaintyMs >= 10);
  assert.equal(mapping.diagnostics().outputUnavailableCount, 0, 'an ordinary repeated snapshot is not an invalid native sample');
  frames.reset();
});

test('audio late125/early45 boundaries include delay uncertainty without enlarging either window', () => {
  for (const uncertainty of [0, 4]) {
    const clock = virtualClock(), shown = [];
    const frames = createTimedFrames((frame, config, id, timing, window) => shown.push({ at: clock.now(), window }), clock);
    frames.delay(constantDelay(0));
    frames.audio(ref({ audibleTimeMs: 1170, uncertaintyMs: uncertainty }));
    frames.present(picture(), { mode: 'airplay-mirror' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
    clock.advance(1050);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].at, 1045 + uncertainty);
    assert.ok(1170 + uncertainty - shown[0].at <= 125);
    assert.ok(1170 - uncertainty - shown[0].at >= -45);
    frames.reset();
  }
});

test('infeasible output, stale/invalid active audio, and missing source timing drop with explicit state', () => {
  const clock = virtualClock(), shown = [], frames = createTimedFrames(frame => shown.push(frame), clock);
  frames.delay(constantDelay(0)); frames.audio(ref({ audibleTimeMs: 1380 }));
  const impossible = picture(); frames.present(impossible, { mode: 'airplay-mirror' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
  assert.equal(impossible.closed, true); assert.equal(frames.stats().audioSyncState, 'infeasible');
  frames.audio(ref({ audibleTimeMs: 1120, sequence: 2 }));
  const untimed = picture(); frames.present(untimed, { mode: 'airplay-mirror' }, 1, null);
  assert.equal(untimed.closed, true); assert.equal(frames.stats().audioSyncState, 'source-time-unavailable');
  clock.advance(1800);
  const stale = picture(); frames.present(stale, { mode: 'airplay-mirror' }, 1, 1850, { sourceTimeMs: 5800, clockGeneration: 1 });
  assert.equal(stale.closed, true); assert.equal(frames.stats().audioSyncState, 'audio-reference-stale');
  frames.audio(ref({ sequence: 3, state: 'paused', at: 1800 }));
  const paused = picture(); frames.present(paused, { mode: 'airplay-mirror' }, 1, 1850, { sourceTimeMs: 5800, clockGeneration: 1 });
  assert.equal(paused.closed, true); assert.equal(frames.stats().audioSyncState, 'paused');
  assert.equal(shown.length, 0);
  frames.audio(ref({ sequence: 4, state: 'disabled', at: 1800 }));
  const videoOnly = picture(); frames.present(videoOnly, { mode: 'airplay-mirror' }, 1, 1850);
  clock.advance(1830); assert.deepEqual(shown, [videoOnly]);
  frames.reset();
});

test('mode/clock epochs stay isolated and audio references survive video-only epoch resets', () => {
  const clock = virtualClock(), shown = [], frames = createTimedFrames(frame => shown.push(frame), clock);
  frames.delay(constantDelay(0)); frames.audio(ref());
  frames.audio(ref({ mode: 'carplay', type: 6, epoch: 9, state: 'paused' }));
  frames.reset();
  const wrongClock = picture(); frames.present(wrongClock, { mode: 'airplay-mirror' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 2 });
  assert.equal(wrongClock.closed, true); assert.equal(frames.stats().audioSyncState, 'clock-generation');
  const rightClock = picture(); frames.present(rightClock, { mode: 'airplay-mirror' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
  clock.advance(1030); assert.deepEqual(shown, [rightClock]);
  frames.reset();
});

test('clock offset refinement cannot reverse stable decoded media order', () => {
  const clock = virtualClock(), shown = [], frames = createTimedFrames(frame => shown.push(frame), clock);
  frames.audio(ref({ mode: 'airplay-mirror', type: 6 }));
  const first = picture(), next = picture();
  frames.present(first, { mode: 'airplay-mirror', epoch: 1 }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
  clock.advance(1110);
  assert.deepEqual(shown, [first]);
  frames.present(next, { mode: 'airplay-mirror', epoch: 1 }, 1, 1040, { sourceTimeMs: 5020, clockGeneration: 1 });
  assert.deepEqual(shown, [first, next], 'rate/offset refinement changes estimates without retiring the next source frame');
  frames.reset();
});

test('audio-window expiry during GPU upload cannot clear or submit the canvas', () => {
  let at = 1040;
  const calls = [], canvas = { width: 160, height: 90, addEventListener() {}, removeEventListener() {} };
  const gl = { canvas, isContextLost: () => false };
  for (const name of ['createProgram', 'createShader', 'shaderSource', 'compileShader', 'attachShader', 'deleteShader',
    'linkProgram', 'useProgram', 'createBuffer', 'bindBuffer', 'bufferData', 'getAttribLocation', 'enableVertexAttribArray',
    'vertexAttribPointer', 'createTexture', 'bindTexture', 'texParameteri', 'viewport', 'clearColor', 'clear', 'drawArrays',
    'deleteTexture', 'deleteBuffer', 'deleteProgram']) gl[name] = () => { calls.push(name); return {}; };
  gl.texImage2D = () => { calls.push('upload'); at = 1050; };
  canvas.getContext = kind => kind === 'webgl2' ? gl : null;
  const presenter = createFramePresenter(canvas, { now: () => at, applyTimingPolicy: true });
  presenter.audio(ref({ mode: 'airplay-mirror', type: 6, audibleTimeMs: 1000 }));
  const frame = picture();
  presenter.present(frame, { mode: 'airplay-mirror', epoch: 1 }, 1000,
    { sourceTimeMs: 5000, clockGeneration: 1, at: 1000, earliest: 875, latest: 1045 });
  assert.ok(calls.includes('upload'));
  assert.equal(calls.includes('clear'), false); assert.equal(calls.includes('drawArrays'), false);
  assert.equal(frame.closed, true); assert.equal(presenter.stats().audioRenderSyncDroppedFrames, 1);
  assert.equal(presenter.stats().expiredFrames, 0, 'this is the audio early45ms boundary, not the video mode cap');
  presenter.dispose();
});

test('final main-thread presentation checks newer audio output and transfer staleness', () => {
  let at = 1060, draws = 0;
  const context = { fillRect() {}, drawImage() { draws++; } };
  const canvas = { width: 100, height: 100, getContext: kind => kind === '2d' ? context : null, removeEventListener() {} };
  const presenter = createFramePresenter(canvas, { now: () => at, applyTimingPolicy: true });
  const oldWindow = { sourceTimeMs: 5000, clockGeneration: 1, earliest: 1000, latest: 1200, at: 1000 };
  presenter.audio(ref({ mode: 'carplay', audibleTimeMs: 1000 }));
  const late = picture(); presenter.present(late, { mode: 'airplay-mirror', epoch: 1 }, 1000, oldWindow);
  assert.equal(draws, 1, 'unrelated CarPlay audio cannot constrain an AirPlay picture');
  presenter.audio(ref({ mode: 'airplay-mirror', type: 6, audibleTimeMs: 1000 }));
  const changed = picture(); presenter.present(changed, { mode: 'airplay-mirror', epoch: 1 }, 1000, oldWindow);
  assert.equal(changed.closed, true); assert.equal(draws, 1, 'latest actual audio window supersedes a transferred old window');
  presenter.audio(ref({ mode: 'airplay-mirror', type: 6, sequence: 2, audibleTimeMs: 1150, at: 1060 }));
  presenter.present(picture(), { mode: 'airplay-mirror', epoch: 1 }, 1000, oldWindow);
  assert.equal(draws, 2);
  at = 1811;
  const stale = picture(); presenter.present(stale, { mode: 'airplay-mirror', epoch: 1 }, 1800, oldWindow);
  assert.equal(stale.closed, true); assert.equal(draws, 2);
  presenter.dispose();
});

test('six virtual hours retain skew with clock drift, jitter and dynamic output latency', () => {
  const origin = 1700000000000, serverOrigin = 700000000;
  const clockRate = 1.00047, start = origin + 10000;
  const clock = virtualClock(start), mapping = createAudioOutputMapping({ now: clock.now, timeOrigin: () => origin });
  let deviceLatency = 30, audioDelay = 90, frameCount = 0, sequence = 0, largestSkew = -Infinity, smallestSkew = Infinity;
  let producerBoundary = null;
  const context = { state: 'running', currentTime: 10, sampleRate: 48000, baseLatency: 0.01, outputLatency: 0.02,
    getOutputTimestamp: () => ({ contextTime: (clock.now() - origin - deviceLatency) / 1000, performanceTime: clock.now() - origin }) };
  const sourceAt = time => serverOrigin + (time - origin) / clockRate;
  const frames = createTimedFrames((frame, config, id, timing, window) => {
    const skew = window.audioAt - clock.now();
    // Independent speaker oracle: this emitted sample reaches the device after
    // its real pipeline delay, then source samples advance at the source clock.
    // Do not derive this truth from the output mapping under test.
    const physicalAudioAt = producerBoundary.at + deviceLatency
      + (sourceAt(timing) - producerBoundary.sourceTimeMs) * clockRate;
    const physicalSkew = physicalAudioAt - clock.now();
    assert.ok(physicalSkew >= -45 - .001 && physicalSkew <= 125 + .001,
      `physical audio/video skew ${physicalSkew}ms at device latency ${deviceLatency}ms (mapping claimed ${skew}ms)`);
    largestSkew = Math.max(largestSkew, skew); smallestSkew = Math.min(smallestSkew, skew); frameCount++;
    assert.ok(skew >= -45 - 0.001 && skew <= 125 + 0.001);
    assert.ok(clock.now() <= timing + 200, 'AirPlay source cap never expands for a slow device');
    frame.close();
  }, clock);
  frames.delay(constantDelay(0));
  for (let elapsed = 0; elapsed < 6 * 3600000; elapsed += 100) {
    clock.advance(start + elapsed);
    deviceLatency = [30, 180, 55, 260][Math.floor(elapsed / 300000) % 4];
    audioDelay = [90, 120, 40, -10][Math.floor(elapsed / 300000) % 4];
    context.currentTime = (clock.now() - origin) / 1000;
    producerBoundary = { at: clock.now(), sourceTimeMs: sourceAt(clock.now() + deviceLatency - audioDelay) };
    // A longer device pipeline is offset by render-ahead, using the producer's
    // available future PCM; the total actual skew, not device latency alone, is
    // what determines whether a video frame is feasible.
    const reference = mapping.reference({ mode: 'airplay-mirror', type: 0, epoch: 1, generation: 1, clockGeneration: 1,
      sequence: ++sequence, state: 'playing', contextTimeMs: context.currentTime * 1000,
      sourceTimeMs: producerBoundary.sourceTimeMs, mediaRate: 1 / clockRate, filterDelayMs: 14 }, context);
    frames.audio(reference);
    const lead = 25 + ((elapsed / 100 * 17) % 31);
    const timing = clock.now() + lead;
    frames.present(picture(), { mode: 'airplay-mirror', epoch: 1 }, 1, timing,
      { sourceTimeMs: sourceAt(timing), clockGeneration: 1 });
    clock.advance(start + elapsed + 99);
  }
  assert.equal(frameCount, 215964, '36 output-timestamp regressions at abrupt device changes explicitly drop one frame, then recover');
  assert.ok(largestSkew <= 125.001 && largestSkew > 124.9);
  assert.ok(smallestSkew >= -45.001 && smallestSkew < 11);
  assert.equal(frames.stats().audioSyncDroppedFrames, 36);
  assert.equal(frames.stats().audioSyncUnavailableFrames, 36);
  frames.reset();
});
