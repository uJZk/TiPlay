// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';
import { AudioSourceClock } from '../../site/play/audio-source-clock.js';

const runtime = new SoxrRuntime();

test('production resampling uses compiled WebAssembly and isolates processor heaps', () => {
  let converter;
  try {
    const standalone = new SoxrRuntime();
    assert.ok(standalone.exports.memory instanceof WebAssembly.Memory);
    assert.notEqual(standalone.exports.memory.buffer, runtime.exports.memory.buffer);
    assert.equal(standalone.exports.memory.buffer.byteLength, 16 * 1024 * 1024);
    converter = standalone.create(44100, 48000, 2);
    const input = Float32Array.from({ length: 4096 * 2 }, (_, i) => Math.sin(Math.floor(i / 2) * 0.1) * 0.2);
    const output = new Float32Array(512 * 2);
    converter.setRatio(44100 / 48000 * 1.0001, 128);
    const result = converter.process(input, 4096, output);
    assert.ok(result.produced > 0 && result.consumed > 0);
    assert.ok(output.slice(0, result.produced * 2).some(value => Math.abs(value) > 0.1));
    assert.ok(output.every(Number.isFinite));
  } finally {
    converter?.dispose();
  }
});

const waveform = (frame, rate) => 0.31 * Math.sin(frame * 2 * Math.PI * 997 / rate)
  + 0.13 * Math.sin(frame * 2 * Math.PI * 7919 / rate) + 0.07 * Math.cos(frame * 2 * Math.PI * 137 / rate);
function pcm(start, frames, rate, channels = 1) {
  return Int16Array.from({ length: frames * channels }, (_, i) => Math.round(waveform(start + Math.floor(i / channels), rate) * 32767));
}
function resample({ packetFrames, inputRate = 44100, outputRate = 48000, frames = 44100, changing = false }) {
  const converter = runtime.create(inputRate, outputRate, 1), input = Float32Array.from({ length: frames }, (_, i) => waveform(i, inputRate));
  const block = new Float32Array(128), output = [];
  let inputFrame = 0, nextPacket = packetFrames;
  for (let call = 0; call < 100000; call++) {
    if (inputFrame === nextPacket) nextPacket = Math.min(frames, nextPacket + packetFrames);
    if (changing) converter.setRatio(inputRate / outputRate * (1 + 0.0007 * Math.sin(output.length / outputRate)), 128);
    const result = converter.process(input.subarray(inputFrame, nextPacket), nextPacket - inputFrame, block, 128);
    inputFrame += result.consumed; output.push(...block.subarray(0, result.produced));
    if (!result.consumed && !result.produced && inputFrame >= frames) break;
  }
  converter.dispose(); return output;
}

test('real libsoxr preserves a multitone signal across arbitrary packet boundaries', () => {
  const together = resample({ packetFrames: 4096 }), split = resample({ packetFrames: 137 });
  assert.equal(together.length, split.length);
  assert.deepEqual(together, split, 'packetization cannot restart filter/phase state');
  let error = 0, energy = 0;
  for (let i = 500; i < together.length - 500; i++) {
    const expected = waveform(i * 44100 / 48000, 44100);
    error += (together[i] - expected) ** 2; energy += expected ** 2;
  }
  assert.ok(10 * Math.log10(error / energy) < -20, 'nonzero 137Hz/997Hz/7919Hz waveform remains recognizable after true polyphase resampling');
});

test('stateful variable ratio slew stays continuous and rejects out-of-range corrections', () => {
  const output = resample({ packetFrames: 293, frames: 44100 * 3, changing: true });
  assert.ok(output.length > 140000);
  assert.ok(output.every(Number.isFinite));
  const peak = Math.max(...output.slice(1000, 10000).map(Math.abs));
  assert.ok(peak > 0.35 && peak < 0.6);
  const converter = runtime.create(48000, 48000, 1);
  assert.throws(() => converter.setRatio(1.1)); converter.dispose();
});

test('actual polyphase downsampling suppresses an out-of-band tone instead of aliasing it into speech', () => {
  const converter = runtime.create(96000, 48000, 1), output = [], block = new Float32Array(128);
  const input = Float32Array.from({ length: 192000 }, (_, i) => 0.3 * Math.sin(i * 2 * Math.PI * 997 / 96000)
    + 0.3 * Math.sin(i * 2 * Math.PI * 36000 / 96000));
  let consumed = 0;
  for (let call = 0; call < 10000; call++) {
    const result = converter.process(input.subarray(consumed), input.length - consumed, block, 128);
    consumed += result.consumed; output.push(...block.subarray(0, result.produced));
    if (!result.consumed && !result.produced) break;
  }
  converter.dispose();
  function amplitude(frequency) {
    let sine = 0, cosine = 0, count = 0;
    for (let i = 1000; i < output.length - 1000; i++) {
      sine += output[i] * Math.sin(i * 2 * Math.PI * frequency / 48000);
      cosine += output[i] * Math.cos(i * 2 * Math.PI * frequency / 48000); count++;
    }
    return 2 * Math.hypot(sine, cosine) / count;
  }
  const wanted = amplitude(997), aliased = amplitude(12000);
  assert.ok(Math.abs(wanted - 0.3) < 0.001);
  assert.ok(20 * Math.log10(aliased / wanted) < -80, '36kHz input must not become a strong 12kHz alias; linear interpolation/decimation would fail');
});

test('actual impulse calibration is independent of the upstream vr_delay TODO', () => {
  for (const rate of [8000, 16000, 24000, 32000, 44100, 48000, 96000]) {
    const delay = runtime.filterDelay(rate, 48000);
    assert.ok(Math.abs(delay) < 1, `real ${rate}Hz impulse delay remains inside the reserved 1ms uncertainty`);
    assert.equal(runtime.filterDelay(rate, 48000), delay);
  }
  assert.notEqual(runtime.filterDelay(48000, 48000), 100000 / 48000);
});

test('live SoundTouch catches up by 20 percent while preserving a 1kHz tone', async () => {
  const { LiveResampler } = await import('../../site/play/live-tempo.js');
  const converter = new LiveResampler(runtime, 48000, 48000, 1);
  const input = Float32Array.from({ length: 96000 }, (_, i) => Math.sin(i * 2 * Math.PI * 1000 / 48000) * .3);
  const output = new Float32Array(128), samples = [];
  let consumed = 0;
  try {
    converter.setRatio(1, 0); converter.setTempo(1.2);
    for (let call = 0; call < 10000; call++) {
      const result = converter.process(input.subarray(consumed), Math.min(4096, input.length - consumed), output, 128);
      consumed += result.consumed; samples.push(...output.subarray(0, result.produced));
      if (!result.consumed && !result.produced && !result.progress && consumed === input.length) break;
    }
    assert.ok(samples.length > 77000 && samples.length < 81000, `accelerated duration: ${samples.length}`);
    let crossings = 0;
    for (let i = 2001; i < samples.length - 2000; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
    const pitch = crossings * 48000 / (samples.length - 4000);
    assert.ok(Math.abs(pitch - 1000) < 3, `pitch retained: ${pitch}Hz`);
    assert.throws(() => converter.setRatio(1.2), /drift range/, 'libsoxr no longer accepts catch-up acceleration');
    assert.throws(() => converter.setTempo(1.21), /Invalid live tempo/);
  } finally { converter.dispose(); }
});

test('real SoundTouch source markers remain inside the conservative deadline allowance through tempo changes', async () => {
  const { LiveResampler } = await import('../../site/play/live-tempo.js');
  const converter = new LiveResampler(runtime, 48000, 48000, 1);
  const input = Float32Array.from({ length: 96000 }, (_, i) => .2 + .3 * i / 96000);
  const block = new Float32Array(128);
  let consumed = 0, emitted = 0, virtual = 0;
  try {
    converter.setRatio(1, 0);
    for (let call = 0; call < 10000; call++) {
      const tempo = emitted < 24000 ? 1.05 : emitted < 48000 ? 1.2 : 1;
      converter.setTempo(tempo);
      const result = converter.process(input.subarray(consumed), Math.min(4096, input.length - consumed), block);
      consumed += result.consumed;
      for (let i = 0; i < result.produced; i++) if (emitted + i > 512) {
        const marker = (block[i] - .2) * 96000 / .3;
        assert.ok(marker >= virtual + i * tempo - converter.sourceUncertaintyMs * 48,
          `actual source ${marker} must not precede the reported oldest source ${virtual + i * tempo - 960}`);
      }
      virtual += result.produced * tempo; emitted += result.produced;
      if (!result.consumed && !result.produced && !result.progress && consumed === input.length) break;
    }
    assert.ok(emitted > 80000);
  } finally { converter.dispose(); }
});

function harness({ rate = 48000, channels = 1, mode = 'carplay', buffered = false, sourceBase = 800000, clockRate = 1 } = {}) {
  const credits = [], player = new ContinuousAudio(runtime, rate, channels, 48000,
    (bytes, reason, generation) => credits.push({ bytes, reason, generation }), 6500, { buffered, mode });
  player.epoch = 7; player.generation = 3; player.debug(true);
  const clock = { generation: 1, rate: clockRate, state: 'locked' }, block = new Float32Array(128 * channels);
  let inputFrame = 0, sequence = 0;
  function feed(untilFrame, arrivalMs = 0) {
    while (inputFrame < untilFrame) {
      const count = Math.min(960, untilFrame - inputFrame);
      player.push({ pcm: pcm(inputFrame, count, rate, channels).buffer, presentationMs: sourceBase + inputFrame * 1000 / rate,
        sequence: sequence++, arrivalLocalTimeMs: arrivalMs, generation: 3 }, clock.rate);
      inputFrame += count;
    }
  }
  return { player, credits, block, feed, clock, sourceBase };
}

test('CarPlay eases into a 45ms backlog and tapers using its measured error trend without a filter reset', () => {
  const h = harness({ buffered: true }), step = 128 / 48;
  h.feed(96000);
  for (let q = 0; q < 20; q++) h.player.render(h.sourceBase + q * step, q * step, h.clock, 128, h.block);
  const backend = h.player.backend;
  const corrections = [];
  for (let q = 20; q < 8000; q++) {
    if (q % 7 === 0) h.feed(Math.ceil((q * step + 2000) * 48), q * step);
    h.player.render(h.sourceBase + q * step + 45, q * step, h.clock, 128, h.block);
    corrections.push(h.player.phaseCorrectionPpm / 1e6);
    assert.equal(h.player.backend, backend, 'queued lateness is corrected through the live filter');
    assert.ok(h.block.every(Number.isFinite));
  }
  assert.ok(corrections[0] < .001, 'a sudden 45ms error cannot jump directly to 20 percent');
  assert.ok(Math.max(...corrections) < .1, 'this transient backlog does not warrant maximum speed');
  assert.ok(corrections.every(rate => rate >= 0 && rate <= .2));
  assert.ok(corrections.at(-1) < .001 && h.player.phaseErrorMs < .1, `speed returns toward normal: correction=${corrections.at(-1)}, error=${h.player.phaseErrorMs}`);
  assert.equal(h.player.recoveryCounts['clock-step'], undefined);
  h.player.clear();
});

test('a real 250ms SoundTouch catch-up holds tempo while falling and brakes without resetting the filter', () => {
  const h = harness({ buffered: true }), step = 128 / 48;
  let backend, held = false, minimum = Infinity;
  try {
    for (let q = 0; q < 10000; q++) {
      if (q % 7 === 0) h.feed(Math.ceil((q * step + 2000) * 48), q * step);
      h.player.render(h.sourceBase + q * step + (q > 20 ? 250 : 0), q * step, h.clock, 128, h.block);
      backend ||= h.player.backend;
      assert.equal(h.player.backend, backend);
      assert.ok(h.block.every(Number.isFinite));
      if (h.player.catchUpBoost?.state === 'holding') held = true;
      if (q > 20) minimum = Math.min(minimum, h.player.phaseErrorMs);
    }
    assert.ok(held, 'the real pipeline enters hold while source error is falling');
    assert.ok(minimum > -5, `braking cannot produce a large lead: ${minimum}`);
    assert.ok(Math.abs(h.player.phaseErrorMs) < 1);
    assert.equal(h.player.catchUpBoost, null);
    assert.deepEqual(h.player.recoveryCounts, {});
  } finally { h.player.clear(); }
});

test('expired active SoundTouch output fades from the published edge and releases both engines', () => {
  const h = harness({ buffered: true }); h.feed(96000);
  try {
    for (let q = 0; q < 200; q++) h.player.render(h.sourceBase + q * 128 / 48 + (q > 10 ? 45 : 0),
      q * 128 / 48, h.clock, 128, h.block);
    const backend = h.player.backend, edge = h.block.at(-1);
    assert.equal(backend.active, true);
    const raw = h.player.rawCursorMs;
    h.player.render(raw, 200 * 128 / 48, { ...h.clock, localOriginMs: 0, serverOriginMs: h.sourceBase },
      128, h.block, 1, { outputAt: raw - h.sourceBase + 400, uncertaintyMs: 0, limitMs: 300 });
    assert.equal(h.player.lastRecoveryReason, 'source-deadline');
    for (let i = 0; i < 128; i++) assert.ok(Math.abs(h.block[i] - edge * (239 - i) / 240) < .25 / 32768, `frame=${i}, edge=${edge}, actual=${h.block[i]}, last=${h.player.last[0]}, tail=${h.player.tailRemaining}`);
    assert.equal(backend.resampler.handle, 0);
    assert.throws(() => backend.stretch.setTempo(1), /Invalid live tempo/);
  } finally { h.player.clear(); }
});

test('equal errors command different acceleration according to their growth trend', () => {
  const growing = harness(), shrinking = harness();
  try {
    for (let q = 0; q <= 375; q++) {
      const seconds = q * 128 / 48000;
      growing.player.phaseErrorMs = 20 + 20 * seconds;
      shrinking.player.phaseErrorMs = 60 - 20 * seconds;
      growing.player.updateCatchUp(seconds * 1000, 128);
      shrinking.player.updateCatchUp(seconds * 1000, 128);
    }
    assert.ok(Math.abs(growing.player.phaseErrorMs - shrinking.player.phaseErrorMs) < 1e-6);
    assert.ok(growing.player.catchUpTrend > 15 && shrinking.player.catchUpTrend < -15);
    assert.ok(growing.player.catchUpCorrection > shrinking.player.catchUpCorrection,
      'at the same 40ms error, continuing growth warrants stronger acceleration than recovery');
    for (let q = 376; q < 10000; q++) {
      growing.player.phaseErrorMs = 40 + q;
      growing.player.updateCatchUp(q * 128 / 48, 128);
      assert.ok(growing.player.catchUpCorrection >= 0 && growing.player.catchUpCorrection <= .2);
    }
    assert.equal(growing.player.catchUpCorrection, .2, 'sustained growing debt can eventually use the cap');
  } finally { growing.player.clear(); shrinking.player.clear(); }
});

test('crossing 200ms ramps toward 20 percent instead of jumping to it', () => {
  for (const error of [199, 200, 200.001, 250, 300]) {
    const h = harness();
    try {
      h.player.phaseErrorMs = error;
      let previous = 0;
      for (let q = 0; q < 2000; q++) {
        h.player.updateCatchUp(q * 128 / 48, 128);
        const rate = h.player.catchUpCorrection;
        assert.ok(rate >= 0 && rate <= .2);
        assert.ok(Math.abs(rate - previous) <= .1 * 128 / 48000 + 1e-12);
        if (!q) assert.ok(rate < .001, 'the threshold never causes an instantaneous tempo jump');
        previous = rate;
      }
      assert.equal(previous, error > 200 ? .2 : .05);
    } finally { h.player.clear(); }
  }
});

function boostTrace(h, error, start, duration) {
  const step = 128 / 48;
  for (let time = start; time < start + duration; time += step) {
    h.player.phaseErrorMs = typeof error === 'function' ? error(time - start) : error;
    h.player.updateCatchUp(time, 128);
  }
}

test('declining delay holds the applied boost below 200ms, then releases after sustained lack of progress', () => {
  const h = harness();
  try {
    boostTrace(h, 300, 0, 3500);
    h.player.phaseCorrectionPpm = 120000; // Capacity allowed 12%, not the requested 20%.
    boostTrace(h, t => 300 - t * .05, 3500, 2500);
    assert.equal(h.player.catchUpBoost.state, 'holding');
    assert.ok(Math.abs(h.player.catchUpCorrection - .12) < 1e-9);
    assert.ok(h.player.phaseErrorMs < 200);
    boostTrace(h, 175, 6000, 600);
    assert.equal(h.player.catchUpBoost.state, 'holding', 'a short plateau does not release the tempo');
    boostTrace(h, 175, 6600, 600);
    assert.equal(h.player.catchUpBoost, null, 'a full second without meaningful decline returns to adaptive control');
    assert.ok(h.player.catchUpCorrection < .12);
  } finally { h.player.clear(); }
});

test('a stalled high-delay boost cannot repeatedly rearm while still above the soft limit', () => {
  const h = harness();
  try {
    boostTrace(h, 350, 0, 3500);
    h.player.phaseCorrectionPpm = 100000;
    boostTrace(h, t => 350 - t * .04, 3500, 1500);
    assert.equal(h.player.catchUpBoost.state, 'holding');
    boostTrace(h, 290, 5000, 3000);
    assert.equal(h.player.catchUpBoost, null);
    assert.equal(h.player.catchUpBoostArmed, false);
    assert.ok(h.player.catchUpCorrection <= .05);
    boostTrace(h, 180, 8000, 100);
    boostTrace(h, 210, 8100, 100);
    assert.equal(h.player.catchUpBoost.state, 'ramping');
  } finally { h.player.clear(); }
});

test('held tempo brakes before the target and is cancelled by unknown timing or inadequate PCM', () => {
  for (const trigger of ['target', 'clock', 'pcm', 'reset']) {
    const h = harness();
    try {
      boostTrace(h, 300, 0, 3500);
      h.player.phaseCorrectionPpm = 100000;
      boostTrace(h, t => 300 - t * .03, 3500, 2000);
      assert.equal(h.player.catchUpBoost.state, 'holding');
      if (trigger === 'target') boostTrace(h, 50, 5500, 100);
      if (trigger === 'clock') h.player.phaseCorrection(128, false);
      if (trigger === 'pcm') h.player.phaseCorrection(128);
      if (trigger === 'reset') h.player.recover('clock-generation');
      assert.equal(h.player.catchUpBoost, null, trigger);
    } finally { h.player.clear(); }
  }
});

test('trend history rejects quantum jitter and forgets old errors after a time gap', () => {
  const h = harness();
  try {
    for (let q = 0; q < 1000; q++) {
      h.player.phaseErrorMs = 40 + (q % 2 ? 3 : -3);
      h.player.updateCatchUp(q * 128 / 48, 128);
    }
    assert.ok(Math.abs(h.player.catchUpTrend) < 1, 'alternating render jitter is not sustained drift');
    assert.ok(h.player.catchUpSamples.length <= 151);
    h.player.phaseErrorMs = 45;
    h.player.updateCatchUp(10000, 128);
    assert.equal(h.player.catchUpTrend, 0, 'a new timing interval cannot inherit an old slope');
    assert.equal(h.player.catchUpSamples.length, 1);
  } finally { h.player.clear(); }
});

test('CarPlay does not accelerate into a source hole or chase an unavailable target', () => {
  const h = harness({ buffered: true });
  h.feed(960);
  h.player.push({ pcm: pcm(4800, 960, 48000).buffer, presentationMs: h.sourceBase + 100,
    sequence: 99, arrivalLocalTimeMs: 0, generation: 3 });
  h.player.render(h.sourceBase, 0, h.clock, 128, h.block);
  h.player.render(h.sourceBase + 128 / 48 + 20, 128 / 48, h.clock, 128, h.block);
  assert.ok(h.player.phaseErrorMs > 19);
  assert.equal(h.player.phaseCorrectionPpm, 0, 'later packets beyond the missing interval are not usable acceleration reserve');
  h.player.render(null, 256 / 48, h.clock, 128, h.block);
  assert.equal(h.player.phaseCorrectionPpm, 0, 'a stale phase error cannot request 20 percent acceleration');
  h.player.clear();
});

test('the catch-up reserve includes real DSP-buffered input after original packets retire', () => {
  const h = harness({ buffered: true }); h.feed(96000);
  try {
    for (let q = 0; q < 200; q++) h.player.render(h.sourceBase + q * 128 / 48 + (q > 10 ? 45 : 0),
      q * 128 / 48, h.clock, 128, h.block);
    assert.ok(h.player.inputFrame > h.player.sourceFrame);
    for (const packet of h.player.queue.splice(0)) h.player.retire(packet, 'capacity');
    h.player.phaseErrorMs = 100; h.player.catchUpCorrection = .001;
    assert.ok(h.player.phaseCorrection(128) > 0, 'retired input still owned by SoundTouch is not treated as an empty pipeline');
    h.player.catchUpBoost = { state: 'holding', held: .2 };
    h.player.catchUpCorrection = .2;
    assert.ok(h.player.phaseCorrection(128) < .2, 'a small internal tail cannot sustain 20 percent catch-up');
    assert.equal(h.player.catchUpBoost, null);
  } finally { h.player.clear(); }
});

test('continuous output sample count survives clock refinement and dynamic packet jitter', () => {
  const h = harness({ channels: 2 }), samples = [], quantumMs = 128000 / 48000;
  let smallest = Infinity, biggest = 0;
  for (let quantum = 0; quantum < 6000; quantum++) {
    const context = quantum * quantumMs;
    // Deterministic arrival bursts change queued network lead, not the output cursor.
    if (quantum % 7 === 0) h.feed(Math.ceil((context + 200 + (quantum % 11)) * 48), context);
    if (quantum === 3000) h.clock.rate = 1.00008;
    const target = h.sourceBase + (quantum < 3000 ? context : 3000 * quantumMs + (context - 3000 * quantumMs) / h.clock.rate);
    h.player.render(target, context, h.clock, 128, h.block);
    if (quantum > 10) {
      const energy = h.block.reduce((sum, value) => sum + value ** 2, 0);
      smallest = Math.min(smallest, energy); biggest = Math.max(biggest, energy);
      samples.push(h.block[0]);
      assert.equal(h.player.state, 'playing');
      assert.ok(Math.abs(h.player.phaseErrorMs) < 1);
    }
  }
  assert.ok(smallest > 5 && biggest > 10);
  assert.equal(h.player.outputFrames, 6000 * 128);
  assert.equal(h.player.counters.rebufferCount, 0);
  assert.ok(h.credits.some(value => value.reason === 'played' && value.generation === 3));
  h.player.clear(); assert.equal(h.player.bytes, 0);
});

test('underrun, pause and clock jumps use bounded fades with explicit recovery', () => {
  const h = harness(), quantumMs = 128000 / 48000;
  h.feed(4800);
  const emitted = [];
  for (let quantum = 0; quantum < 80; quantum++) {
    const context = quantum * quantumMs;
    h.player.render(h.sourceBase + context, context, h.clock, 128, h.block); emitted.push(...h.block);
  }
  assert.equal(h.player.state, 'rebuffering');
  assert.equal(h.player.reason, 'underrun');
  assert.ok(emitted.slice(-1024).every(value => value === 0), 'a pause settles to digital silence without replaying a tail');
  const firstSilent = emitted.findIndex((value, i) => i > 4800 && value === 0 && emitted.slice(i, i + 240).every(sample => sample === 0));
  assert.ok(firstSilent > 0);
  assert.ok(Math.abs(emitted[firstSilent - 1]) < 0.005, 'fade ends close to zero');
  const context = 80 * quantumMs;
  h.feed(Math.ceil((context + 300) * 48), context);
  h.clock.generation++;
  h.player.render(h.sourceBase + context, context, h.clock, 128, h.block);
  assert.equal(h.player.state, 'playing');
  assert.ok(Math.abs(h.block[0]) < 0.01, 'resuming enters through a fade');
  h.player.render(h.sourceBase + context + 200, context + quantumMs, h.clock, 128, h.block);
  assert.ok(h.player.counters.rebufferCount >= 2);
  h.player.clear();
});

test('source rate estimator separates producer drift from burst jitter over eight virtual hours', () => {
  for (const producerPpm of [-350, 275]) {
    const tracker = new AudioSourceClock(48000, { arrival: true }), producerRate = 1 + producerPpm / 1e6, browserRate = 1.00012;
    for (let second = 0; second < 8 * 3600; second++) {
      for (let packet = 0; packet < 6; packet++) {
        const realMs = second * 1000 + packet * 150;
        const jitter = ((second * 17 + packet * 31) % 5) * 4;
        tracker.observe(realMs * 48 * producerRate, realMs * browserRate + jitter, browserRate);
      }
      tracker.advance(second * 1000);
    }
    assert.ok(Math.abs((tracker.rate - producerRate) * 1e6) < 15, `producer ${producerPpm}ppm is independent of Android/browser +120ppm`);
    assert.equal(tracker.confidence, 0.5, 'arrival-only evidence retains limited confidence');
  }
});

test('source rate model rejects network queue steps and keeps buffered prefetch out of the servo', () => {
  const tracker = new AudioSourceClock(48000, { arrival: true });
  for (let second = 0; second < 180; second++) {
    tracker.observe(second * 48000, second * 1000 + (second >= 60 ? 100 : 0));
    tracker.advance(second * 1000);
    assert.ok(Math.abs(tracker.rate - 1) < 0.0001, 'a 100ms network queue step is not a sampling oscillator');
  }
  const h = harness({ buffered: true }); h.feed(48000, 0);
  assert.equal(h.player.sourceClock.points.length, 0); assert.equal(h.player.sourceClock.rate, 1); h.player.clear();
});

test('real dynamic DSP drains producer drift while a different device clock and Android clock remain continuous', () => {
  const browserRate = 1.00012, producerRate = 1.000275, deviceRate = 0.99992;
  const h = harness({ clockRate: browserRate }), quantumMs = 128000 / 48000;
  let firstLead = null, lastLead = null, totalEnergy = 0;
  for (let quantum = 0; quantum < 45000; quantum++) {
    const contextMs = quantum * quantumMs, localMs = contextMs / deviceRate, serverMs = localMs / browserRate;
    if (quantum % 7 === 0) h.feed(Math.ceil((serverMs + 200) * 48 * producerRate), localMs);
    h.player.render(h.sourceBase + serverMs, contextMs, h.clock, 128, h.block);
    if (quantum > 10) {
      assert.equal(h.player.state, 'playing');
      assert.ok(Math.abs(h.player.phaseErrorMs) < 2);
      totalEnergy += h.block[quantum % 128] ** 2;
    }
    if (quantum === 38000) firstLead = (h.player.queue.at(-1).end - h.player.sourceFrame) / 48;
    if (quantum === 44000) lastLead = (h.player.queue.at(-1).end - h.player.sourceFrame) / 48;
  }
  assert.ok(totalEnergy > 1000, 'the complete drift run processes the nonzero multitone waveform');
  assert.ok(Math.abs((h.player.sourceClock.rate - producerRate) * 1e6) < 15);
  assert.ok(Math.abs(lastLead - firstLead) < 8, 'the source reservoir settles instead of growing with the producer oscillator');
  assert.equal(h.player.counters.rebufferCount, 0);
  h.player.clear();
});

test('fixed AAC frames stay adjacent after natural positive arrival-clock acquisition', () => {
  const rate = 48000, producerRate = 1.00025, packetFrames = 1024;
  const h = harness(), quantumMs = 128000 / rate;
  let inputFrame = 0, sequence = 0;
  for (let quantum = 0; quantum < 75000 / quantumMs; quantum++) {
    const contextMs = quantum * quantumMs;
    while (inputFrame / 48 / producerRate <= contextMs + 200) {
      const previous = h.player.lastPacket;
      h.player.push({ pcm: pcm(inputFrame, packetFrames, rate).buffer,
        presentationMs: h.sourceBase + inputFrame / 48, sequence: sequence++, generation: 3,
        arrivalLocalTimeMs: inputFrame / 48 / producerRate }, 1);
      if (previous) assert.equal(h.player.lastPacket.first, previous.end, 'nominal RTP timestamps remain contiguous after the source oscillator locks');
      inputFrame += packetFrames;
    }
    h.player.render(h.sourceBase + contextMs, contextMs, h.clock, 128, h.block);
    if (quantum > 10) {
      assert.equal(h.player.state, 'playing');
      assert.ok(h.block.some(value => Math.abs(value) > 0.1));
    }
  }
  assert.ok(h.player.sourceClock.confidence > 0);
  assert.ok(Math.abs((h.player.sourceClock.rate - 1) * 1e6 - 250) < 1);
  assert.deepEqual(h.player.recoveryCounts, {}); h.player.clear();
});

test('measured AirPlay presentation anchors still use their acquired source rate for adjacency', () => {
  const h = harness({ mode: 'airplay-mirror' }), sourceRate = 1.00035;
  for (let second = 0; second < 90; second++) {
    h.player.sourceClock.observe(second * 48000, second * 1000 / sourceRate);
    h.player.sourceClock.advance(second * 1000);
  }
  assert.equal(h.player.sourceClock.confidence, 1);
  for (let sequence = 0; sequence < 5; sequence++) {
    h.player.push({ pcm: pcm(sequence * 960, 960, 48000).buffer,
      presentationMs: h.sourceBase + sequence * 20 / sourceRate, sequence, generation: 3 });
    assert.equal(h.player.lastPacket.first, sequence * 960);
  }
  h.player.clear();
});

test('AirPlay sample timestamps preserve the signal across presentation-clock refinements', () => {
  const rate = 44100, packetFrames = 480, h = harness({ rate, mode: 'airplay-mirror' });
  const quantumMs = 128000 / 48000;
  let inputFrame = 0, sequence = 0;
  for (let quantum = 0; quantum < 4000; quantum++) {
    const contextMs = quantum * quantumMs;
    while (inputFrame * 1000 / rate < contextMs + 150) {
      const correction = inputFrame < rate * 2 ? 0 : inputFrame < rate * 5 ? 0.25 : -1.5;
      const previous = h.player.lastPacket;
      h.player.push({ pcm: pcm(inputFrame, packetFrames, rate).buffer,
        presentationMs: h.sourceBase + inputFrame * 1000 / rate + correction,
        decodeTimestampUs: 7000000000 + inputFrame * 1000000 / rate, sequence: sequence++, generation: 3 });
      if (previous) assert.equal(h.player.lastPacket.first, previous.end, 'a new NTP anchor cannot insert or remove source samples');
      inputFrame += packetFrames;
    }
    h.player.render(h.sourceBase + contextMs, contextMs, h.clock, 128, h.block);
    if (quantum > 10) assert.equal(h.player.state, 'playing');
  }
  assert.deepEqual(h.player.recoveryCounts, {});
  h.player.clear();
});

test('AirPlay stable sample coordinates retain real packet loss and half-sample gaps', () => {
  for (const gap of [0.5, 480]) {
    const rate = 44100, h = harness({ rate, mode: 'airplay-mirror' });
    h.player.push({ pcm: pcm(0, 480, rate).buffer, presentationMs: h.sourceBase,
      decodeTimestampUs: 7000000000, sequence: 0, generation: 3 });
    h.player.push({ pcm: pcm(480, 480, rate).buffer,
      presentationMs: h.sourceBase + 480000 / rate - 1.5,
      decodeTimestampUs: 7000000000 + (480 + gap) * 1000000 / rate, sequence: 1, generation: 3 });
    assert.equal(h.player.queue[1].first, 480 + Math.round(gap));
    assert.equal(h.player.read(0, 960), 480, 'presentation-clock movement must not hide missing source samples');
    h.player.clear();
  }
});

test('real DSP compensates a slow output clock without recurring hard recovery or signal holes', () => {
  const h = harness({ channels: 2, buffered: true }), deviceRate = 0.996, quantumMs = 128000 / 48000;
  let smallest = Infinity, maximumPhase = 0;
  for (let quantum = 0; quantum < 90000 / quantumMs; quantum++) {
    const contextMs = quantum * quantumMs, physicalMs = contextMs / deviceRate;
    if (quantum % 7 === 0) h.feed(Math.ceil((physicalMs + 2000) * 48), physicalMs);
    h.player.render(h.sourceBase + physicalMs, contextMs, h.clock, 128, h.block, deviceRate);
    if (quantum > 10) {
      smallest = Math.min(smallest, h.block.reduce((sum, value) => sum + value * value, 0));
      maximumPhase = Math.max(maximumPhase, Math.abs(h.player.phaseErrorMs));
      assert.equal(h.player.state, 'playing');
    }
  }
  assert.equal(h.clock.rate, 1, 'Android/browser clock retains its original meaning');
  assert.deepEqual(h.player.recoveryCounts, {});
  assert.ok(maximumPhase < 0.1, `maximum phase ${maximumPhase}`);
  assert.ok(smallest > 8, `minimum block energy ${smallest}`);
  assert.ok(h.player.reference(0).resampleRatePpm > 3900, 'ppm telemetry preserves ratios that round to 1.00');
  h.player.clear();
});

test('stream diagnostics identify the last rendered context boundary rather than a dummy zero', () => {
  const h = harness();
  assert.equal(h.player.stats().contextTimeMs, null, 'an unrendered stream has no context anchor');
  h.player.render(null, 12340, h.clock, 128, h.block);
  assert.equal(h.player.stats().contextTimeMs, 12340 + 128000 / 48000);
  h.player.clear();
  assert.equal(h.player.stats().contextTimeMs, null, 'retirement cannot retain an old device anchor');
});

test('real PCM marker oracle rejects expired fresh audio while the last published edge fades', () => {
  const rate = 48000, sourceOrigin = 800000;
  const player = new ContinuousAudio(runtime, rate, 1, rate, () => {}, 1000, { mode: 'carplay' });
  // This marker is measured from the actual resampled waveform, independently
  // of rawCursorMs and the deadline calculation under test.
  for (let first = 0; first < 16000; first += 800) player.push({
    pcm: Int16Array.from({ length: 800 }, (_, index) => first + index).buffer,
    presentationMs: sourceOrigin + first / 48, sequence: first / 800, generation: 1, arrivalLocalTimeMs: first / 48,
  });
  const clock = { generation: 1, state: 'tracking', rate: 1, serverOriginMs: sourceOrigin, localOriginMs: 0 };
  const block = new Float32Array(128);
  for (let quantum = 0; quantum < 20; quantum++) {
    const context = quantum * 128 / 48;
    player.render(sourceOrigin + context, context, clock, 128, block, 1,
      { outputAt: context + 280, limitMs: 300, uncertaintyMs: 2 });
    if (quantum > 5) {
      const markerSourceMs = block[100] * 32768 / 48;
      const acousticAt = context + 280 + 100 / 48;
      assert.ok(Math.abs(acousticAt - markerSourceMs - 280) < 1, `actual PCM delay ${acousticAt - markerSourceMs}ms at quantum ${quantum} confirms the source-to-speaker oracle`);
      assert.equal(player.sourceDeadlineState, 'within-bound');
    }
  }
  const published = block.at(-1);
  const context = 20 * 128 / 48;
  clock.localOriginMs = -29; // A real accepted phase refinement, below the 30ms reset threshold.
  player.render(sourceOrigin + context + 29, context, clock, 128, block, 1,
    { outputAt: context + 280, limitMs: 300, uncertaintyMs: 2 });
  assert.equal(player.sourceDeadlineState, 'violated');
  assert.ok(player.sourceDeltaUpperMs > 300);
  assert.equal(player.sourceDeadlineRejectedFrames, 128);
  for (let i = 0; i < block.length; i++) assert.ok(Math.abs(block[i] - published * (239 - i) / 240) < 0.25 / 32768,
    'expired fresh PCM is replaced by the prior published sample fading over exactly 240 frames');
  assert.equal(player.lastRecoveryReason, 'source-deadline');
  player.clear();
});

test('unobservable source/output uncertainty stays unknown while valid continuous audio may continue', () => {
  const h = harness(); h.feed(10000);
  h.player.render(h.sourceBase, 0, h.clock, 128, h.block, 1, { unknownReason: 'clock-uncertainty-unavailable' });
  assert.equal(h.player.sourceDeadlineState, 'unknown');
  assert.equal(h.player.sourceDeadlineReason, 'clock-uncertainty-unavailable');
  assert.equal(h.player.sourceDeltaUpperMs, null);
  assert.equal(h.player.state, 'playing'); h.player.clear();
});
