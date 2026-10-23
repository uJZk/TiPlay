// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioDeviceClock } from '../../site/play/audio-device-clock.js';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';
import { constantDelay } from '../../site/play/delay-plan.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';

function acquiringClock() {
  const clock = new AudioDeviceClock(); clock.debug(true);
  for (let at = 0; at <= 6000; at += 100) clock.observe(at * .988, at, at);
  assert.ok(clock.targetRate < clock.rate && clock.rate < 1);
  assert.equal(clock.snapshot().fitStatus, 'tracking');
  return clock;
}

test('pipeline re-acquisition holds the applied oscillator without retaining its old fit or target', () => {
  const clock = acquiringClock(), applied = clock.rate, generation = clock.generation;
  clock.reset('output-step', { preserveRate: true });
  const snapshot = clock.snapshot(6001);
  assert.equal(snapshot.rate, applied); assert.equal(clock.targetRate, applied);
  assert.equal(snapshot.generation, generation + 1); assert.equal(snapshot.points, 0);
  assert.equal(snapshot.confidence, 0); assert.equal(snapshot.uncertaintyMs, null);
  assert.equal(snapshot.acceptedFitAgeMs, undefined); assert.equal(snapshot.fitDispersionMs, undefined);
  assert.equal(snapshot.fitRejected, 0); assert.equal(snapshot.fitStatus, 'acquiring');
  clock.advance(7000); clock.advance(20000);
  assert.equal(clock.rate, applied, 'an obsolete unachieved target cannot keep steering after re-acquisition');
});

test('actual context and render-domain resets still discard the oscillator correction', () => {
  for (const reason of ['context', 'suspended', 'context-backwards', 'reset', 'backwards', 'gap', 'step']) {
    const clock = acquiringClock(); clock.reset(reason);
    assert.equal(clock.rate, 1, reason); assert.equal(clock.targetRate, 1, reason);
    assert.equal(clock.snapshot().confidence, 0, reason);
  }
});

test('a newly measured oscillator replaces held correction through the existing bounded slew', () => {
  const clock = acquiringClock(); clock.reset('output-step', { preserveRate: true });
  for (let at = 7000; at <= 30000; at += 100) {
    const before = clock.rate;
    clock.observe(100 + (at - 7000) * 1.008, at, at);
    assert.ok(Math.abs(clock.rate - before) <= .000100000001);
    assert.ok(clock.rate >= .98 && clock.rate <= 1.02);
  }
  assert.ok(Math.abs(clock.rate - 1.008) < 1e-12);
  assert.equal(clock.snapshot().fitStatus, 'tracking');
});

let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentTime = 0; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js');

test('real PCM keeps a slow oscillator through small route steps, while real large steps and rate changes still recover', () => {
  const hz = 48000, blockFrames = 128, sourceBase = 8000000, networkDelay = 20;
  // Hardware and sender clocks are independent of the mapper/worklet estimates.
  const hardwareContext = wall => wall <= 100000 ? wall * .988 : 98800 + (wall - 100000) * 1.008;
  const physicalWall = context => context <= 98800 ? context / .988 : 100000 + (context - 98800) / 1.008;
  const pipeline = wall => wall >= 90000 && wall < 95000 ? 238
    : wall >= 45000 && wall < 85000 && Math.floor((wall - 45000) / 3000) % 2 ? 210 : 200;
  const mapper = createAudioOutputMapping({ now: () => wall, timeOrigin: () => 0 });
  let frame = 0, wall = 0, nextControl = -Infinity, inputFrame = 0, sequence = 0;
  const context = { state: 'running', currentTime: 0, sampleRate: hz, baseLatency: 0, outputLatency: .2,
    getOutputTimestamp() {
      return wall > pipeline(wall) ? { contextTime: hardwareContext(wall - pipeline(wall)) / 1000, performanceTime: wall }
        : { contextTime: 0, performanceTime: 0 };
    } };
  const processor = new Processor(), post = data => processor.port.onmessage({ data });
  processor.port.postMessage = data => {
    if (data.renderProbe) mapper.acknowledgeRenderProbe(data.renderProbe, context);
  };
  const calibration = new SoxrRuntime().filterDelay(hz, hz);
  post({ calibration: { rate: hz, outputRate: hz, delayMs: calibration } });
  const clock = { version: 2, generation: 0, serverOriginMs: sourceBase, localOriginMs: 0,
    rate: 1, state: 'locked', uncertaintyMs: 0 };
  const output = [new Float32Array(blockFrames), new Float32Array(blockFrames)];
  let previousCursor = -Infinity, previousRecovery = 0, smallStepRecoveries = 0, realStepRecoveries = 0;
  let smallStepQuanta = 0, firstChangedRateFit = null;
  let largestPhysicalSourceAge = -Infinity, largestPhysicalPhaseError = 0;
  try {
    while (wall < 138000) {
      globalThis.currentFrame = frame; globalThis.currentTime = frame / hz;
      context.currentTime = frame / hz; wall = physicalWall(frame * 1000 / hz);
      while (inputFrame / 48 < wall + 500) {
        const first = inputFrame;
        const pcm = Int16Array.from({ length: 960 }, (_, i) => Math.round((.25 * Math.sin((first + i) * 2 * Math.PI * 997 / hz)
          + .1 * Math.sin((first + i) * 2 * Math.PI * 137 / hz)) * 32767));
        post({ type: 0, semanticType: 0, mode: 'carplay', epoch: 1, rate: hz, channels: 1, flags: 1,
          sequence: sequence++, generation: 1, presentationMs: sourceBase + first / 48,
          arrivalLocalTimeMs: wall, pcm: pcm.buffer });
        inputFrame += 960;
      }
      if (wall >= nextControl) {
        const mapping = mapper.capture(context), device = mapper.deviceClock();
        post({ clock, deviceClock: device, renderProbe: mapper.takeRenderProbe(),
          contextAnchor: mapping ? { contextTimeMs: mapping.contextTimeMs, localTimeMs: mapping.performanceTimeMs } : null,
          outputUncertaintyMs: mapping?.uncertaintyMs ?? null,
          plans: { audio: constantDelay(networkDelay), video: constantDelay(0) } });
        nextControl = wall + 20;
        if (wall > 100000 && firstChangedRateFit === null && device.fitStatus === 'tracking'
          && Math.abs(device.targetRatePpm - 8000) < 1) firstChangedRateFit = wall - 100000;
      }
      processor.process([], [output]);
      const audio = processor.timelines.get(0), recovery = audio.recoveryCounts['clock-step'] || 0;
      assert.ok(audio.rawCursorMs >= previousCursor, 'recovery cannot replay already emitted source samples');
      previousCursor = audio.rawCursorMs;
      if (recovery > previousRecovery) {
        if (wall >= 45000 && wall < 85000) smallStepRecoveries += recovery - previousRecovery;
        if (wall >= 90000 && wall < 95000) {
          realStepRecoveries += recovery - previousRecovery;
          assert.ok(audio.lastClockStep.phaseErrorMs > 30, 'the real 38ms route change still uses the unchanged recovery gate');
        }
      }
      previousRecovery = recovery;
      const endWall = physicalWall((frame + blockFrames) * 1000 / hz);
      const physicalAge = sourceBase + endWall + pipeline(wall) - audio.rawCursorMs;
      if (wall >= 40000) {
        largestPhysicalSourceAge = Math.max(largestPhysicalSourceAge, physicalAge);
        assert.notEqual(audio.sourceDeadlineState, 'violated', 'the independent300ms source deadline remains in force');
        assert.equal(audio.recoveryCounts['source-deadline'], undefined);
      }
      if (wall >= 45000 && wall < 85000) {
        smallStepQuanta++;
        largestPhysicalPhaseError = Math.max(largestPhysicalPhaseError, Math.abs(physicalAge - networkDelay));
        assert.equal(audio.state, 'playing');
        assert.ok(output[0].some(value => Math.abs(value) > 1e-6), 'the real multitone PCM has no silent quantum');
        assert.ok(output[0].every(value => Number.isFinite(value) && Math.abs(value) < 1));
      }
      frame += blockFrames;
    }
    assert.equal(smallStepRecoveries, 0, 'small pipeline changes cannot discard an already applied oscillator correction');
    assert.ok(smallStepQuanta > 14000); assert.ok(largestPhysicalPhaseError < 15);
    assert.equal(realStepRecoveries, 1, 'retaining the oscillator does not hide a genuinely large route step');
    assert.ok(firstChangedRateFit > 4000 && firstChangedRateFit < 17000, 'changed hardware rate is re-estimated within the existing history window');
    assert.ok(largestPhysicalSourceAge < 100, 'external hardware/source oracle stays well inside the unchanged300ms limit');
    assert.ok(Math.abs(mapper.deviceClock().ratePpm - 8000) < 1);
  } finally { post({ dispose: true }); }
});

test('expired fade output is rejected once, idle quanta do not fabricate recovery events, and real PCM keeps its deadline', () => {
  const runtime = new SoxrRuntime(), base = 8000000;
  const audio = new ContinuousAudio(runtime, 48000, 1, 48000, () => {}, 6500, { mode: 'carplay' });
  audio.debug(true);
  const clock = { generation: 0, rate: 1, state: 'locked', localOriginMs: 0, serverOriginMs: base };
  const out = new Float32Array(128), deadline = outputAt => ({ outputAt, uncertaintyMs: 0, limitMs: 300 });
  let sequence = 0;
  const feed = (at, value = 8000) => audio.push({ sequence: sequence++, generation: 1,
    presentationMs: base + at, arrivalLocalTimeMs: at, pcm: new Int16Array(960).fill(value).buffer });
  try {
    for (let at = 0; at < 400; at += 20) feed(at);
    audio.render(base + 200, 0, clock, 128, out, 1, deadline(230));
    assert.equal(audio.state, 'playing'); assert.ok(out.some(value => value !== 0));
    audio.recover('underrun');
    assert.ok(audio.tailRemaining > 0);
    audio.render(null, 128 / 48, clock, 128, out, 1, deadline(1000));
    assert.ok(out.every(value => value === 0), 'expired copies of previously emitted PCM cannot leak through the fade');
    assert.equal(audio.recoveryCounts['source-deadline'], 1);
    const rejected = audio.sourceDeadlineRejectedFrames, recoveries = { ...audio.recoveryCounts };
    for (let i = 0; i < 10000; i++) {
      audio.render(null, (i + 2) * 128 / 48, clock, 128, out, 1, deadline(1000 + i * 128 / 48));
      assert.ok(out.every(value => value === 0));
    }
    assert.deepEqual(audio.recoveryCounts, recoveries);
    assert.equal(audio.sourceDeadlineRejectedFrames, rejected);
    assert.equal(audio.sourceDeadlineState, 'unknown'); assert.equal(audio.sourceDeadlineReason, 'no-output');
    feed(400, 0); feed(420, 0);
    audio.render(base + 400, 27000, clock, 128, out, 1, deadline(1200));
    assert.equal(audio.recoveryCounts['source-deadline'], 2, 'new real PCM is checked even when every source sample is zero');
    assert.equal(audio.sourceDeadlineState, 'violated'); assert.ok(audio.sourceDeadlineRejectedFrames > rejected);
    feed(1500); feed(1520);
    audio.render(base + 1500, 27003, clock, 128, out, 1, deadline(1530));
    assert.equal(audio.state, 'playing'); assert.equal(audio.sourceDeadlineState, 'within-bound');
    assert.ok(out.some(value => value !== 0), 'fresh, timely PCM resumes after the idle period');
  } finally { audio.clear(); }
});
