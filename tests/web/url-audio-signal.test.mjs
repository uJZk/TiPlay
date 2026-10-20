// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectUrlAudioSignal, renderScheduledUrlAudio, urlAudioSample } from './fixtures/url-audio-signal.mjs';

function node(first, length, sampleRate, { sourceFirst = first, phaseInvert = false } = {}) {
  const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length }, (_, index) =>
    urlAudioSample(sourceFirst + index, channel, sampleRate) * (phaseInvert && channel === 0 ? -1 : 1)));
  return { time: first / sampleRate, buffer: { length, sampleRate, getChannelData: channel => channels[channel] } };
}

for (const sampleRate of [44100, 48000]) test(`URL signal oracle recognises continuous packetized ${sampleRate}Hz PCM`, () => {
  const nodes = Array.from({ length: Math.ceil(sampleRate / 1024) }, (_, index) => node(index * 1024, 1024, sampleRate));
  const result = inspectUrlAudioSignal(renderScheduledUrlAudio(nodes, sampleRate, 1), 0.05, 0.95);
  assert.equal(result.gaps, 0); assert.equal(result.overlaps, 0); assert.equal(result.frameIdentityErrors, 0);
  assert.ok(result.maximumPhaseErrorRadians < 1e-5); assert.equal(result.maximumStepResidual, 0);
});

test('URL signal oracle rejects a dropped source frame, a one-frame overlap and a phase discontinuity', () => {
  const sampleRate = 48000, base = [node(0, 1024, sampleRate), node(1024, 1024, sampleRate), node(2048, 1024, sampleRate)];
  const dropped = [...base]; dropped[1] = node(1024, 1023, sampleRate, { sourceFirst: 1025 });
  const gap = inspectUrlAudioSignal(renderScheduledUrlAudio(dropped, sampleRate, 0.06), 0.001, 0.059);
  assert.equal(gap.gaps, 1); assert.ok(gap.frameIdentityErrors >= 1024); assert.ok(gap.maximumPhaseErrorRadians > 0.1);
  const overlapping = [...base]; overlapping[1] = node(1023, 1024, sampleRate, { sourceFirst: 1024 });
  const overlap = inspectUrlAudioSignal(renderScheduledUrlAudio(overlapping, sampleRate, 0.06), 0.001, 0.059);
  assert.equal(overlap.overlaps, 1); assert.ok(overlap.maximumStepResidual > 0.01);
  const inverted = [...base]; inverted[1] = node(1024, 1024, sampleRate, { phaseInvert: true });
  const phase = inspectUrlAudioSignal(renderScheduledUrlAudio(inverted, sampleRate, 0.06), 0.001, 0.059);
  assert.equal(phase.gaps, 0); assert.equal(phase.overlaps, 0); assert.equal(phase.frameIdentityErrors, 0);
  assert.ok(phase.maximumPhaseErrorRadians > 3); assert.ok(phase.maximumStepResidual > 0.1);
});
