// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';
import { ContinuousAudio } from '../../site/play/continuous-audio.js';
import { AudioSourceClock } from '../../site/play/audio-source-clock.js';

const module = await WebAssembly.compile(readFileSync(new URL('../../site/play/vendor/soxr/soxr.wasm', import.meta.url)));
const runtime = new SoxrRuntime(module);
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
