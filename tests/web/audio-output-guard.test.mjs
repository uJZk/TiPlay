// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';
import { constantDelay } from '../../site/play/delay-plan.js';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

// Only the browser host and native timestamp source are synthetic. The output
// mapping, worklet, timeline, resampler and emitted PCM are production code.
const calibration = { rate: 48000, outputRate: 48000, delayMs: new SoxrRuntime().filterDelay(48000, 48000) };
let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: value => this.messages.push(value) }; }
};
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000;
globalThis.currentTime = 1; globalThis.currentFrame = 48000;
await import('../../site/play/audio-worklet.js');

function scenario(mode, type, { isolated = false, observe = false, sustained = false, debug = false } = {}) {
  let at = 1000, frame = 48000;
  globalThis.currentTime = frame / 48000; globalThis.currentFrame = frame;
  const processor = new Processor(), post = data => processor.port.onmessage({ data });
  const context = { state: 'running', currentTime: 1, sampleRate: 48000, baseLatency: .012, outputLatency: .188,
    getOutputTimestamp() {
      const offset = at === 1240 && isolated || at >= 1240 && sustained ? 38 : 0;
      return { contextTime: (at - 200 - offset) / 1000, performanceTime: at };
    } };
  const mapping = createAudioOutputMapping({ now: () => at, timeOrigin: () => 0 });
  if (debug) post({ debug: true, diagnosticRevision: 1 });
  post({ calibration });
  post({ clock: { version: 2, generation: 1, serverOriginMs: 800000, localOriginMs: 0,
    rate: 1, state: 'fresh', uncertaintyMs: 0 },
  plans: { audio: constantDelay(60), video: constantDelay(0) } });
  for (let first = 0, sequence = 0; first < 96000; first += 960, sequence++) {
    const pcm = Int16Array.from({ length: 960 }, (_, i) => Math.round(10000 * Math.sin((first + i) * .13)));
    post({ type, mode, epoch: 1, generation: 1, flags: 1, rate: 48000, channels: 1, sequence,
      presentationMs: 800000 + first / 48, decodeTimestampUs: first / 48 * 1000, pcm: pcm.buffer });
  }
  const player = processor.timelines.get(type), backendAfterStartup = [], steps = [], samples = [], captures = [], trace = [];
  const recover = player.recover.bind(player);
  player.recover = reason => {
    if (reason === 'clock-step') steps.push({ contextMs: frame / 48, phaseErrorMs: player.phaseErrorMs });
    recover(reason);
  };
  try {
    for (let quantum = 0; quantum < 150; quantum++, frame += 128) {
      globalThis.currentFrame = frame; globalThis.currentTime = frame / 48000;
      at = frame / 48; context.currentTime = currentTime;
      if (quantum % 15 === 0) {
        const pair = mapping.capture(context);
        captures.push({ at, state: mapping.diagnostics().outputState });
        post({ deviceClock: mapping.deviceClock(),
          contextAnchor: pair ? { contextTimeMs: pair.contextTimeMs, localTimeMs: pair.performanceTimeMs } : null,
          outputUncertaintyMs: pair?.uncertaintyMs ?? null });
      }
      const output = [new Float32Array(128), new Float32Array(128)];
      processor.process([], [output]); samples.push(...output[0]);
      trace.push({ at, phaseErrorMs: player.phaseErrorMs, ratio: player.slewRatio,
        rawCursorMs: player.rawCursorMs, sourceFrame: player.sourceFrame });
      if (quantum === 1) backendAfterStartup.push(player.backend);
      if (observe) {
        mapping.deviceClock(); mapping.diagnostics();
        player.reference(at); player.stats(); player.reference(at + 1);
      }
    }
    return { steps, samples, captures, trace, recoveryCounts: { ...player.recoveryCounts },
      sourceDeadlineRejectedFrames: player.sourceDeadlineRejectedFrames,
      backendPreserved: player.backend === backendAfterStartup[0],
      bytes: player.bytes, deviceClock: mapping.deviceClock(), diagnostics: mapping.diagnostics(),
      streamStats: player.stats(), workletStats: processor.messages.filter(value => value.diagnostics).at(-1)?.diagnostics };
  } finally { post({ dispose: true }); }
}

for (const [mode, type] of [['carplay', 0], ['airplay-mirror', 6]]) {
  test(`${mode}: an isolated ordered 38ms native fault preserves the real Soxr stream`, () => {
    const control = scenario(mode, type), fault = scenario(mode, type, { isolated: true });
    for (const value of [control, fault]) {
      assert.deepEqual(value.steps, []);
      assert.deepEqual(value.recoveryCounts, {});
      assert.equal(value.sourceDeadlineRejectedFrames, 0);
      assert.equal(value.backendPreserved, true);
      assert.ok(value.bytes > 0, 'the reproduction is neither source starvation nor a missed deadline');
    }
    assert.deepEqual(fault.captures.filter(value => value.state === 'timestamp-discontinuity').map(value => value.at), [1240, 1280]);
    assert.equal(fault.captures.find(value => value.at === 1320).state, 'timestamp');
    assert.equal(fault.deviceClock.generation, control.deviceClock.generation);
    let maximumDifference = 0, differentSamples = 0, firstDifference = null;
    for (let i = 0; i < fault.samples.length; i++) if (fault.samples[i] !== control.samples[i]) {
      maximumDifference = Math.max(maximumDifference, Math.abs(fault.samples[i] - control.samples[i]));
      differentSamples++; firstDifference ??= i;
    }
    const firstControlDifference = fault.trace.findIndex((value, i) => value.phaseErrorMs !== control.trace[i].phaseErrorMs);
    const phaseDifference = Math.max(...fault.trace.map((value, i) => Math.abs(value.phaseErrorMs - control.trace[i].phaseErrorMs)));
    const ratioDifference = Math.max(...fault.trace.map((value, i) => Math.abs(value.ratio - control.trace[i].ratio)));
    // Without a trusted output pair the live DSP retains its previous tiny
    // phase correction (this fixture: about .122us phase / .0122ppm ratio).
    // Compare actual PCM with half the input PCM16 quantum; diagnostic reads
    // below still require exact sample equality. Neither path recovers its DSP.
    assert.ok(maximumDifference <= .5 / 32768, JSON.stringify({ maximumDifference, differentSamples, firstDifference,
      firstControlDifference, phaseDifference, ratioDifference,
      firstControl: control.trace[firstControlDifference], firstFault: fault.trace[firstControlDifference] }));
    assert.ok(fault.samples.slice(128).every(Number.isFinite));
    assert.ok(fault.samples.slice(128).some(value => Math.abs(value) > .1));
  });

  test(`${mode}: reading bounded diagnostic evidence never changes emitted PCM or recovery`, () => {
    const untouched = scenario(mode, type, { isolated: true });
    const observed = scenario(mode, type, { isolated: true, observe: true });
    assert.deepEqual(observed.samples, untouched.samples);
    assert.deepEqual(observed.steps, untouched.steps);
    assert.deepEqual(observed.recoveryCounts, untouched.recoveryCounts);
    assert.deepEqual(observed.deviceClock, untouched.deviceClock);
  });

  test(`${mode}: source-fit and render-quantum logging leaves real Soxr PCM and recovery unchanged`, () => {
    const control = scenario(mode, type, { isolated: true }), debug = scenario(mode, type, { isolated: true, observe: true, debug: true });
    assert.deepEqual(debug.samples, control.samples); assert.deepEqual(debug.steps, control.steps);
    assert.deepEqual(debug.recoveryCounts, control.recoveryCounts); assert.deepEqual(debug.deviceClock, control.deviceClock);
    assert.equal(control.streamStats.sourceClockFitStatus, undefined);
    assert.equal(debug.streamStats.sourceClockFitStatus, 'disabled');
    assert.equal(debug.streamStats.sourceClockFitRejectReason, 'buffered-prefetch');
    assert.equal(debug.workletStats.renderQuantumFrames, 128);
    assert.equal(debug.workletStats.renderQuantumMinFrames, 128); assert.equal(debug.workletStats.renderQuantumMaxFrames, 128);
  });

  test(`${mode}: two coherent native pairs still establish a real pipeline step`, () => {
    const stepped = scenario(mode, type, { sustained: true });
    assert.equal(stepped.captures.find(value => value.at === 1240).state, 'timestamp-discontinuity');
    assert.equal(stepped.captures.find(value => value.at === 1280).state, 'timestamp');
    assert.equal(stepped.steps.length, 1, 'the real changed route remains an actual timing correction');
    assert.ok(Math.abs(stepped.steps[0].phaseErrorMs - 38) < .1);
    assert.equal(stepped.recoveryCounts['clock-step'], 1);
    assert.equal(stepped.sourceDeadlineRejectedFrames, 0);
  });
}
