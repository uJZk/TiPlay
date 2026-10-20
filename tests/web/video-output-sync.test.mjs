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
const ref = (extra = {}) => ({ mode: 'carplay', type: 0, epoch: 1, generation: 1, sequence: 1, clockGeneration: 1,
  state: 'playing', sourceTimeMs: 5000, audibleTimeMs: 1120, mediaRate: 1, at: 1000, uncertaintyMs: 0,
  outputMethod: 'timestamp', ...extra });

test('video records audible output without changing its own presentation clock', () => {
  const clock = virtualClock(), shown = [];
  const frames = createTimedFrames((frame, config, id, timing, window) => shown.push({ frame, timing, window, at: clock.now() }), clock);
  frames.delay(constantDelay(0)); frames.audio(ref());
  const frame = picture(); frames.present(frame, { mode: 'carplay' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
  clock.advance(1029); assert.equal(shown.length, 0);
  clock.advance(1030); assert.equal(shown.length, 1);
  assert.equal(shown[0].at, 1030, 'network video target is already inside the actual-output interval');
  assert.equal(shown[0].window.audioAt - shown[0].at, 90);
  assert.ok(shown[0].at <= 1050);
  frames.reset();
});

test('a repeated native output pair preserves honest uncertainty without holding video', () => {
  const origin = 1700000000000, clock = virtualClock(origin + 10000), deviceRate = .996;
  const deviceLatency = 80, audioDelay = 110, sourceAt = time => 700000000 + time - origin;
  const mapping = createAudioOutputMapping({ now: clock.now, timeOrigin: () => origin });
  const nativePair = { contextTime: (10000 - deviceLatency) * deviceRate / 1000, performanceTime: 10000 };
  const context = { state: 'running', sampleRate: 48000, baseLatency: .012, outputLatency: .08,
    get currentTime() { return (clock.now() - origin) * deviceRate / 1000; }, getOutputTimestamp: () => nativePair };
  mapping.capture(context);
  clock.advance(clock.now() + 500);
  const producer = { at: clock.now(), sourceTimeMs: sourceAt(clock.now() + deviceLatency - audioDelay) };
  const reference = mapping.reference({ mode: 'carplay', type: 0, epoch: 1, generation: 1, sequence: 1,
    state: 'playing', contextTimeMs: context.currentTime * 1000, sourceTimeMs: producer.sourceTimeMs,
    mediaRate: 1 / deviceRate }, context);
  let draws = 0;
  const frames = createTimedFrames((frame, config, id, timing) => {
    const physicalAudioAt = producer.at + deviceLatency + sourceAt(timing) - producer.sourceTimeMs;
    const physicalSkew = physicalAudioAt - clock.now();
    assert.ok(Number.isFinite(physicalSkew));
    assert.equal(clock.now(), timing - 20, 'audio device uncertainty does not retime video');
    draws++; frame.close();
  }, clock);
  frames.delay(constantDelay(0)); frames.audio(reference);
  const timing = clock.now() + 30;
  frames.present(picture(), { mode: 'carplay' }, 1, timing, { sourceTimeMs: sourceAt(timing) });
  clock.advance(clock.now() + 99);
  assert.equal(draws, 1, 'bounded drift uncertainty still permits a feasible picture');
  assert.equal(reference.outputMethod, 'timestamp-holdover');
  assert.ok(reference.uncertaintyMs >= 10);
  assert.equal(mapping.diagnostics().outputUnavailableCount, 0, 'an ordinary repeated snapshot is not an invalid native sample');
  frames.reset();
});

test('audio device uncertainty is reported without delaying independently scheduled video', () => {
  for (const uncertainty of [0, 4, 150]) {
    const clock = virtualClock(), shown = [];
    const frames = createTimedFrames((frame, config, id, timing, window) => shown.push({ at: clock.now(), window }), clock);
    frames.delay(constantDelay(0)); frames.audio(ref({ audibleTimeMs: 1170, uncertaintyMs: uncertainty }));
    frames.present(picture(), { mode: 'carplay' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
    clock.advance(1050); assert.equal(shown.length, 1); assert.equal(shown[0].at, 1030);
    assert.equal(shown[0].window.uncertaintyMs, uncertainty); assert.equal(shown[0].window.audioAt, 1170);
    frames.reset();
  }
});

test('missing source timing and invalid audio remain explicit without freezing video', () => {
  const clock = virtualClock(), shown = [], frames = createTimedFrames(frame => shown.push(frame), clock);
  frames.delay(constantDelay(0)); frames.audio(ref({ audibleTimeMs: 1400 }));
  const frame = picture(); frames.present(frame, { mode: 'carplay' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 1 });
  clock.advance(1030); assert.deepEqual(shown, [frame]);
  const untimed = picture(); frames.present(untimed, { mode: 'carplay' }, 1, null);
  assert.equal(shown.at(-1), untimed); assert.equal(frames.stats().audioSyncState, 'source-time-unavailable');
  assert.equal(frames.stats().untimedScheduledFrames, 1);
  clock.advance(1800);
  frames.present(picture(), { mode: 'carplay' }, 1, 1850, { sourceTimeMs: 5800, clockGeneration: 1 });
  clock.advance(1830); assert.equal(frames.stats().audioSyncState, 'audio-reference-stale');
  assert.equal(shown.length, 3); assert.equal(frames.stats().audioSyncDroppedFrames, 0);
  frames.audio(ref({ sequence: 2, state: 'paused', at: 1830 }));
  frames.present(picture(), { mode: 'carplay' }, 1, 1900, { sourceTimeMs: 5850, clockGeneration: 1 });
  clock.advance(1880); assert.equal(frames.stats().audioSyncState, 'paused'); assert.equal(shown.length, 4);
  frames.reset();
});

test('mode/clock epochs isolate diagnostic references without suppressing video', () => {
  const clock = virtualClock(), shown = [], frames = createTimedFrames(frame => shown.push(frame), clock);
  frames.delay(constantDelay(0)); frames.audio(ref());
  frames.audio(ref({ mode: 'airplay-mirror', type: 6, epoch: 9, state: 'paused' })); frames.reset();
  const wrongClock = picture(); frames.present(wrongClock, { mode: 'carplay' }, 1, 1050, { sourceTimeMs: 5000, clockGeneration: 2 });
  clock.advance(1030); assert.equal(shown.length, 1); assert.equal(frames.stats().audioSyncState, 'clock-generation');
  const rightClock = picture(); frames.present(rightClock, { mode: 'carplay' }, 1, 1070, { sourceTimeMs: 5020, clockGeneration: 1 });
  clock.advance(1050); assert.deepEqual(shown, [wrongClock, rightClock]);
  assert.equal(frames.stats().audioSyncState, 'audio-output'); frames.reset();
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

test('source deadline expiry during GPU upload cannot clear or submit the canvas', () => {
  let at = 1240;
  const calls = [], canvas = { width: 160, height: 90, addEventListener() {}, removeEventListener() {} };
  const gl = { canvas, isContextLost: () => false };
  for (const name of ['createProgram', 'createShader', 'shaderSource', 'compileShader', 'attachShader', 'deleteShader',
    'linkProgram', 'useProgram', 'createBuffer', 'bindBuffer', 'bufferData', 'getAttribLocation', 'enableVertexAttribArray',
    'vertexAttribPointer', 'createTexture', 'bindTexture', 'texParameteri', 'viewport', 'clearColor', 'clear', 'drawArrays',
    'deleteTexture', 'deleteBuffer', 'deleteProgram']) gl[name] = () => { calls.push(name); return {}; };
  gl.texImage2D = () => { calls.push('upload'); at = 1310; };
  canvas.getContext = kind => kind === 'webgl2' ? gl : null;
  const presenter = createFramePresenter(canvas, { now: () => at, applyTimingPolicy: true });
  presenter.audio(ref({ mode: 'airplay-mirror', type: 6, audibleTimeMs: 1000 }));
  const frame = picture();
  presenter.present(frame, { mode: 'airplay-mirror', epoch: 1 }, 1000,
    { sourceTimeMs: 5000, clockGeneration: 1, at: 1000, earliest: 875, latest: 1045 });
  assert.ok(calls.includes('upload'));
  assert.equal(calls.includes('clear'), false); assert.equal(calls.includes('drawArrays'), false);
  assert.equal(frame.closed, true); assert.equal(presenter.stats().audioRenderSyncDroppedFrames, 0);
  assert.equal(presenter.stats().expiredFrames, 1, 'GPU upload cannot widen the independent 300ms source deadline');
  presenter.dispose();
});

test('final presentation retains current audio evidence and enforces its own deadline after transfer', () => {
  let at = 1060, draws = 0;
  const context = { fillRect() {}, drawImage() { draws++; } };
  const canvas = { width: 100, height: 100, getContext: kind => kind === '2d' ? context : null, removeEventListener() {} };
  const presenter = createFramePresenter(canvas, { now: () => at, applyTimingPolicy: true });
  const oldWindow = { sourceTimeMs: 5000, clockGeneration: 1, earliest: 1000, latest: 1200, at: 1000 };
  presenter.audio(ref({ mode: 'airplay-mirror', type: 6, audibleTimeMs: 1000 }));
  presenter.present(picture(), { mode: 'airplay-mirror', epoch: 1 }, 1000, oldWindow);
  assert.equal(draws, 1); assert.equal(presenter.stats().audioVideoSkewMs, -60);
  at = 1811;
  presenter.present(picture(), { mode: 'airplay-mirror', epoch: 1 }, 1800, oldWindow);
  assert.equal(draws, 2, 'stale audio does not freeze an available video picture');
  const expired = picture(); presenter.present(expired, { mode: 'airplay-mirror', epoch: 1 }, 1500, oldWindow);
  assert.equal(expired.closed, true); assert.equal(draws, 2); presenter.dispose();
});

test('six virtual hours preserve independent deadlines while audio output evidence changes', () => {
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
    assert.ok(Number.isFinite(physicalSkew));
    if (Number.isFinite(skew)) { largestSkew = Math.max(largestSkew, skew); smallestSkew = Math.min(smallestSkew, skew); } frameCount++;
    assert.ok(clock.now() <= timing, 'strict CarPlay source cap never expands for a slow device');
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
    const reference = mapping.reference({ mode: 'carplay', type: 0, epoch: 1, generation: 1, clockGeneration: 1,
      sequence: ++sequence, state: 'playing', contextTimeMs: context.currentTime * 1000,
      sourceTimeMs: producerBoundary.sourceTimeMs, mediaRate: 1 / clockRate, filterDelayMs: 14 }, context);
    frames.audio(reference);
    const lead = 25 + ((elapsed / 100 * 17) % 31);
    const timing = clock.now() + lead;
    frames.present(picture(), { mode: 'carplay', epoch: 1 }, 1, timing,
      { sourceTimeMs: sourceAt(timing), clockGeneration: 1 });
    clock.advance(start + elapsed + 99);
  }
  assert.equal(frameCount, 216000, 'audio output-timestamp regressions do not lose video pictures');
  assert.ok(Number.isFinite(largestSkew) && largestSkew > 125, 'large skew is measured rather than hidden by video loss');
  assert.ok(Number.isFinite(smallestSkew));
  assert.equal(frames.stats().audioSyncDroppedFrames, 0);
  assert.equal(frames.stats().audioSyncUnavailableFrames, 0);
  frames.reset();
});
