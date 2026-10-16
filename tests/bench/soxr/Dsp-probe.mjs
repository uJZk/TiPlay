// SPDX-License-Identifier: GPL-3.0-only
// Independent DSP probe. Prepare historical references with prepare-bench.py, then run from work/.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { SoxrRuntime, StreamingResampler } from './Pinned-streaming-resampler.mjs';
const wasm = new SoxrRuntime(await WebAssembly.compile(readFileSync(new URL('./Existing.wasm', import.meta.url))));
let candidate = wasm;
if (process.argv[2]) {
  const factory = (await import(pathToFileURL(process.argv[2]).href)).default;
  const module = await factory();
  const exports = { memory: { get buffer() { return module.HEAPU8.buffer; } } };
  for (const name of ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done', 'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']) exports[name] = module['_' + name];
  candidate = { exports, create(rate, outputRate, channels) { return new StreamingResampler(this, rate, outputRate, channels); } };
}
function convert(runtime, { rate, outputRate = 48000, channels = 1, packet = 4096, duration = .35, freq = 997, silentRight = false, slew = false }) {
  const frames = Math.ceil(rate * duration), input = new Float32Array(frames * channels), chunk = new Float32Array(128 * channels), output = [];
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    input[frame * channels + channel] = silentRight && channel ? 0 : .3 * Math.sin(2 * Math.PI * (freq + channel * 1744) * frame / rate);
  }
  const stream = runtime.create(rate, outputRate, channels);
  let consumed = 0, boundary = Math.min(packet, frames), inQuantum = 0, quantum = 0, scheduledQuantum = -1;
  for (let call = 0; call < frames * 10; call++) {
    if (consumed === boundary) boundary = Math.min(frames, boundary + packet);
    if (slew && scheduledQuantum !== quantum) {
      scheduledQuantum = quantum;
      // Smoothly cross the 1:1 boundary and exercise both ends of the published drift range.
      const factor = quantum < 30 ? 1 : quantum < 90 ? 1.049 : quantum < 150 ? .951 : 1;
      stream.setRatio(rate / outputRate * factor, 128);
    }
    const result = stream.process(input.subarray(consumed * channels, boundary * channels), boundary - consumed, chunk, 128 - inQuantum);
    consumed += result.consumed;
    output.push(...chunk.subarray(0, result.produced * channels));
    inQuantum += result.produced;
    if (inQuantum === 128) { inQuantum = 0; quantum++; }
    if (!result.consumed && !result.produced && consumed === frames) break;
    assert.ok(call < frames * 10 - 1, 'bounded progress');
  }
  assert.equal(consumed, frames, 'all input consumed');
  assert.ok(output.length > outputRate * duration * channels * .8, 'no unexpected truncation');
  assert.ok(output.every(Number.isFinite), 'finite output');
  stream.dispose();
  return output;
}
function difference(a, b) {
  assert.equal(a.length, b.length, 'equal output counts');
  let peak = 0, square = 0;
  for (let i = 0; i < a.length; i++) { const error = a[i] - b[i]; peak = Math.max(peak, Math.abs(error)); square += error * error; }
  return { peak, rms: Math.sqrt(square / a.length) };
}
const result = { backend: process.argv[2] || 'existing-wasm', cases: [], alias: [], slew: null, calibration: [], longDrift: null };
candidate.calibrations ??= new Map();
for (const rate of [8000, 16000, 24000, 32000, 44100, 48000, 96000]) for (const outputRate of [44100, 48000]) {
  const delayMs = SoxrRuntime.prototype.filterDelay.call(candidate, rate, outputRate), baselineMs = wasm.filterDelay(rate, outputRate);
  assert.ok(Math.abs(delayMs) < 1, 'filter content delay fits current 1 ms uncertainty');
  assert.ok(Math.abs(delayMs - baselineMs) < 1e-5, 'impulse energy centroid matches pinned implementation');
  result.calibration.push({ rate, outputRate, delayMs, baselineMs });
}
for (const rate of [8000, 16000, 24000, 32000, 44100, 48000, 96000]) for (const outputRate of [44100, 48000]) for (const channels of [1, 2]) {
  const options = { rate, outputRate, channels, silentRight: true };
  const whole = convert(candidate, options), split = convert(candidate, { ...options, packet: 137 });
  const packetError = difference(whole, split);
  assert.equal(packetError.peak, 0, 'packetization preserves exact signal');
  const referenceError = difference(whole, convert(wasm, options));
  assert.ok(referenceError.peak < 2e-5, 'candidate matches pinned upstream implementation');
  if (channels === 2) assert.ok(whole.every((value, i) => !(i % 2) || value === 0), 'silent channel remains silent');
  result.cases.push({ rate, outputRate, channels, frames: whole.length / channels, packetError, referenceError });
}
function rms(values) {
  let energy = 0, count = 0;
  for (let i = 2000; i < values.length - 2000; i++) { energy += values[i] ** 2; count++; }
  return Math.sqrt(energy / count);
}
for (const [rate, outputRate, frequency] of [[96000, 48000, 36000], [48000, 44100, 23500], [96000, 44100, 36000]]) {
  const options = { rate, outputRate, duration: 1 };
  const wanted = rms(convert(candidate, { ...options, freq: 997 }));
  const rejected = rms(convert(candidate, { ...options, freq: frequency }));
  const rejectionDb = 20 * Math.log10(rejected / wanted);
  const baselineDb = 20 * Math.log10(rms(convert(wasm, { ...options, freq: frequency })) / rms(convert(wasm, { ...options, freq: 997 })));
  assert.ok(rejectionDb < -70, 'stopband rejection exceeds 70 dB');
  assert.ok(rejectionDb <= baselineDb + 1, 'no >1 dB stopband degradation');
  result.alias.push({ rate, outputRate, frequency, rejectionDb, baselineDb });
}
const variable = { rate: 48000, outputRate: 48000, duration: 1, slew: true, channels: 2 };
const a = convert(candidate, variable), b = convert(candidate, { ...variable, packet: 137 });
const slewPacketError = difference(a, b), slewReferenceError = difference(a, convert(wasm, variable));
assert.ok(slewPacketError.peak < 2e-5, 'output-frame-driven slew preserves signal within vr32 rounding tolerance');
assert.ok(slewReferenceError.peak < 2e-5, 'slew matches pinned implementation');
let jump = 0;
for (let i = 2; i < a.length; i++) jump = Math.max(jump, Math.abs(a[i] - a[i - 2]));
assert.ok(jump < .16, 'bounded sample step across ratio transitions');
result.slew = { slewPacketError, slewReferenceError, maxAdjacentDelta: jump };
// Two continuously retained stereo handles: 120 seconds of source drift, no signal-sized allocation.
{
  const rate = 44100, outputRate = 48000, channels = 2;
  const expected = wasm.create(rate, outputRate, channels), actual = candidate.create(rate, outputRate, channels);
  const input = new Float32Array(4096 * channels), outExpected = new Float32Array(128 * channels), outActual = new Float32Array(128 * channels);
  let inputFrame = 0, consumedExpected = 0, consumedActual = 0, emitted = 0, peakError = 0, errorEnergy = 0, targetSourceFrames = 0;
  for (let quantum = 0; quantum < 45000; quantum++) {
    const ratio = rate / outputRate * (1 + 350e-6 * Math.sin(quantum / 701) + 75e-6 * Math.cos(quantum / 1901));
    const previousRatio = quantum ? rate / outputRate * (1 + 350e-6 * Math.sin((quantum - 1) / 701) + 75e-6 * Math.cos((quantum - 1) / 1901)) : rate / outputRate;
    targetSourceFrames += 128 * (ratio + previousRatio) / 2;
    expected.setRatio(ratio, 128); actual.setRatio(ratio, 128);
    let produced = 0;
    for (let call = 0; produced < 128 && call < 16; call++) {
      const available = call ? 300 : 0;
      if (available) for (let frame = 0; frame < available; frame++) for (let channel = 0; channel < channels; channel++) {
        input[frame * channels + channel] = .3 * Math.sin(2 * Math.PI * (channel ? 2741 : 997) * (inputFrame + frame) / rate);
      }
      const e = expected.process(input, available, outExpected, 128 - produced), a = actual.process(input, available, outActual, 128 - produced);
      assert.deepEqual(a, e, 'candidate and reference consume and produce identical frame counts through long drift');
      inputFrame += e.consumed; consumedExpected += e.consumed; consumedActual += a.consumed;
      for (let i = 0; i < a.produced * channels; i++) {
        assert.ok(Number.isFinite(outActual[i]));
        const error = outActual[i] - outExpected[i]; peakError = Math.max(peakError, Math.abs(error)); errorEnergy += error * error;
      }
      produced += e.produced;
    }
    assert.equal(produced, 128, 'each steady-state quantum completes'); emitted += produced;
  }
  assert.ok(peakError < 2e-5, 'long drift numerical parity');
  // Input lookahead is separate from audible content; it must stay bounded rather than accumulate with clock drift.
  const leadFrames = consumedActual - targetSourceFrames;
  assert.ok(Math.abs(leadFrames) < 1000, 'bounded cumulative input lookahead through long drift');
  actual.dispose(); expected.dispose();
  result.longDrift = { virtualSeconds: emitted / outputRate, emittedFrames: emitted, consumedExpected, consumedActual, leadFrames, peakError, rmsError: Math.sqrt(errorEnergy / (emitted * channels)) };
}
console.log(JSON.stringify(result, null, 2));
