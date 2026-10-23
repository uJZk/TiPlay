// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaEngine } from '../../site/play/airplay-media.js';
import { createUrlAudioSchedulingFixture, inspectScheduledUrlAudioSequence,
  inspectUrlAudioSignal, renderScheduledUrlAudio, urlAudioSample } from './fixtures/url-audio-signal.mjs';

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

async function startSchedulingFixture(options) {
  const h = createUrlAudioSchedulingFixture(createMediaEngine, options);
  await h.media.load('https://fixture.test/continuous-url-audio.mp4'); await h.flush();
  let started = false;
  void h.media.play().then(() => { started = true; }).catch(() => {}); await h.flush();
  for (let tick = 0; tick < 180 && (!started || h.media.currentTime < 0.5); tick++) await h.tick(1 / 60);
  assert.equal(started, true); assert.equal(h.media.error, null);
  return h;
}

function graphTail(nodes) { return Math.max(...nodes.map(node => (node.renderTime ?? node.time) + node.buffer.duration)); }

for (const sampleRate of [44100, 48000]) test(`URL scheduling: ${sampleRate}Hz late rAF leaves silence without overlapping or skipping PCM`, async () => {
  const h = await startSchedulingFixture({ sampleRate });
  try {
    const before = h.media.getPlaybackDiagnostics(), tail = graphTail(h.nodes);
    // Audio keeps rendering while the main thread misses its animation callback.
    // End on a real device quantum 5–8ms beyond the last submitted sample.
    const target = Math.ceil((tail + 0.005) * sampleRate / 128) * 128 / sampleRate;
    h.advance(target + 1e-10 - h.context().elapsed);
    const actualLateMs = (h.context().currentTime - tail) * 1000;
    assert.ok(actualLateMs >= 5 && actualLateMs < 10, `fault must reach the old 10ms grace window: ${actualLateMs}`);
    await h.tick();
    const after = h.media.getPlaybackDiagnostics();
    const rendered = renderScheduledUrlAudio(h.nodes, sampleRate, 2);
    const signal = inspectUrlAudioSignal(rendered, tail - rendered.anchorTime - 0.002, tail - rendered.anchorTime + 0.05);
    assert.ok(signal.gaps > 0, 'already rendered silence cannot be repaired retroactively');
    assert.equal(signal.overlaps, 0, 'late PCM must retain one shared clock anchor instead of starting multiple slices at now');
    const sequence = inspectScheduledUrlAudioSequence(h.nodes);
    assert.equal(sequence.skippedFrames, 0); assert.equal(sequence.repeatedFrames, 0);
    assert.ok(Math.abs(h.media.currentTime - before.scheduledEnd) < 1 / sampleRate,
      'the media clock must restart at the first source sample still waiting for playback');
    assert.equal(after.stallCount, before.stallCount, 'available PCM must not acquire a recovery watermark pause');
    assert.equal(after.audioScheduleUnderruns, 1, 'the audible graph gap must be diagnosed');
    assert.ok(Math.abs(after.audioScheduleUnderrunMs - signal.gaps / sampleRate * 1000) <= 1 / sampleRate * 1000,
      `diagnosed silence must match the submitted graph: ${JSON.stringify({ signal, after })}`);
  } finally { h.media.dispose(); }
});

test('URL scheduling: a finite video surface pool exposes audio underruns after a 180ms main-thread task', async () => {
  const sampleRate = 48000, h = await startSchedulingFixture({ sampleRate, video: true, videoSurfacePool: 6, videoFps: 30 });
  try {
    const before = h.media.getPlaybackDiagnostics(), tail = graphTail(h.nodes), submittedBefore = h.nodes.length;
    assert.ok(before.audioEnd - before.position > 2, 'decoded PCM is already available');
    assert.ok(before.scheduledEnd - before.position < 0.2, 'video coverage limits the audio submission lead');
    h.advance(0.18); await h.tick();
    const beforeStalls = before.stallCount;
    // Returned surfaces arrive in microtasks after this rAF. One next rAF plus
    // one render quantum is enough to consume them; a recovery watermark is not.
    const recoveryBudgetMs = (1 / 60 + 128 / sampleRate) * 1000;
    for (let tick = 0; tick < 2 && h.nodes.length === submittedBefore; tick++) await h.tick(1 / 60);
    assert.ok(h.nodes.length > submittedBefore, 'returned video surfaces must eventually let playback recover');
    const after = h.media.getPlaybackDiagnostics(), gapMs = Math.max(0, h.nodes[submittedBefore].time - tail) * 1000;
    assert.ok(gapMs > 0, 'the injected task must exhaust the real submitted audio lead');
    assert.ok(gapMs <= recoveryBudgetMs, 'ready replacement video must not turn one missed callback into a recovery watermark wait');
    assert.equal(after.stallCount, beforeStalls); assert.equal(after.audioRebufferStops, 0);
    const sequence = inspectScheduledUrlAudioSequence(h.nodes);
    assert.equal(sequence.skippedFrames, 0); assert.equal(sequence.repeatedFrames, 0);
    assert.ok(after.audioScheduleUnderruns >= 1, 'freeze/resume must retain underrun evidence');
    assert.ok(Math.abs(after.audioScheduleUnderrunMs - gapMs) <= 1 / sampleRate * 1000,
      `the gap across rebuffering must remain observable: ${JSON.stringify({ gapMs, before, after })}`);
  } finally { h.media.dispose(); }
});

for (const sampleRate of [44100, 48000]) for (const phase of ['before', 'after'])
test(`URL submission: ${sampleRate}Hz ${phase}-start 40ms task retains PCM without overlap`, async () => {
  let h, armed = false;
  const hook = () => { if (armed) { armed = false; h.advance(0.04); } };
  h = await startSchedulingFixture({ sampleRate, [phase === 'before' ? 'beforeSourceStart' : 'afterSourceStart']: hook });
  try {
    const tail = graphTail(h.nodes), before = h.media.getPlaybackDiagnostics();
    h.advance(Math.max(0, tail - 0.005 - h.context().elapsed)); armed = true; await h.tick();
    const state = h.media.getPlaybackDiagnostics(), rendered = renderScheduledUrlAudio(h.nodes, sampleRate, 2);
    const signal = inspectUrlAudioSignal(rendered, tail - rendered.anchorTime - 0.002, tail - rendered.anchorTime + 0.1);
    const sequence = inspectScheduledUrlAudioSequence(h.nodes);
    assert.equal(armed, false); assert.equal(signal.overlaps, 0);
    assert.equal(sequence.skippedFrames, 0); assert.equal(sequence.repeatedFrames, 0);
    assert.ok(state.audioSubmitUncertaintyMaxMs > 0 && state.audioSubmitUncertaintyMaxMs <= 40 + 128 / sampleRate * 1000);
    assert.ok(signal.gaps > 0 && signal.gaps / sampleRate * 1000 <= state.audioSubmitUncertaintyMaxMs + 1 / sampleRate * 1000,
      'conservative silence must stay within the observed submission uncertainty');
    assert.equal(state.stallCount, before.stallCount);
  } finally { h.media.dispose(); }
});

for (const sampleRate of [44100, 48000]) test(`URL submission: ${sampleRate}Hz future queued PCM absorbs a 40ms task without steady gaps`, async () => {
  for (const phase of ['before', 'after']) {
    let h, armed = false;
    const hook = () => { if (armed) { armed = false; h.advance(0.04); } };
    h = await startSchedulingFixture({ sampleRate, [phase === 'before' ? 'beforeSourceStart' : 'afterSourceStart']: hook });
    try {
      armed = true; await h.tick(1 / 60);
      for (let tick = 0; tick < 55; tick++) await h.tick(1 / 60);
      const signal = inspectUrlAudioSignal(renderScheduledUrlAudio(h.nodes, sampleRate, 2), 0.1, 1.5);
      assert.equal(armed, false); assert.equal(signal.gaps, 0); assert.equal(signal.overlaps, 0); assert.equal(signal.frameIdentityErrors, 0);
      assert.equal(h.media.getPlaybackDiagnostics().audioSubmitUncertaintyMaxMs, 0);
    } finally { h.media.dispose(); }
  }
});

for (const sampleRate of [44100, 48000]) test(`URL submission: ${sampleRate}Hz one render quantum at startup or recovery preserves source order`, async () => {
  for (const recovery of [false, true]) for (const phase of ['before', 'after']) {
    let h, armed = !recovery;
    const hook = () => { if (armed) { armed = false; h.advance(128 / sampleRate); } };
    h = createUrlAudioSchedulingFixture(createMediaEngine, { sampleRate,
      [phase === 'before' ? 'beforeSourceStart' : 'afterSourceStart']: hook });
    try {
      await h.media.load('https://fixture.test/submission-quantum.mp4'); await h.flush();
      void h.media.play().catch(() => {}); await h.flush(); await h.tick();
      if (recovery) {
        for (let tick = 0; tick < 35; tick++) await h.tick(1 / 60);
        const tail = graphTail(h.nodes);
        h.advance(tail + 0.005 - h.context().elapsed); armed = true; await h.tick();
      }
      const rendered = renderScheduledUrlAudio(h.nodes, sampleRate, 2);
      const sequence = inspectScheduledUrlAudioSequence(h.nodes);
      assert.equal(armed, false); assert.ok(rendered.coverage.every(count => count <= 1));
      assert.equal(sequence.skippedFrames, 0); assert.equal(sequence.repeatedFrames, 0);
      assert.ok(h.media.getPlaybackDiagnostics().audioSubmitUncertaintyMaxMs <= 128 / sampleRate * 1000 + 1e-6);
    } finally { h.media.dispose(); }
  }
});

test('URL diagnostics: pending video with healthy future PCM is video starvation', async () => {
  const videoReadGate = new Promise(() => {});
  const h = await startSchedulingFixture({ video: true, videoDeferAt: 24, videoReadGate, videoSurfacePool: 30 });
  try {
    for (let tick = 0; tick < 30 && h.media.currentTime < 0.8; tick++) await h.tick(1 / 60);
    const state = h.media.getPlaybackDiagnostics();
    assert.equal(state.videoReadPending, true); assert.ok(state.audioEnd - state.position > 2);
    assert.equal(state.audioSilenceFrames, 0); assert.equal(state.waitReason, 'video-starved');
  } finally { h.media.dispose(); }
});

test('URL diagnostics: native output timing is finite, supported and owned by the active format', async () => {
  const h = await startSchedulingFixture();
  try {
    const context = h.context();
    assert.equal(h.media.getPlaybackDiagnostics().audioOutputTimestampAgeMs, undefined);
    assert.equal(h.media.getPlaybackDiagnostics().audioOutputTimestampState, 'unavailable');
    context.baseLatency = 0.02; context.outputLatency = 0.03;
    context.getOutputTimestamp = () => ({ contextTime: context.currentTime - 0.01, performanceTime: performance.now() - 4 });
    const valid = h.media.getPlaybackDiagnostics();
    assert.equal(valid.audioOutputTimestampState, 'valid');
    assert.equal(valid.audioBaseLatencyMs, 20); assert.equal(valid.audioOutputLatencyMs, 30);
    assert.ok(valid.audioOutputTimestampAgeMs >= 4 && valid.audioOutputTimestampAgeMs < 100);
    assert.ok(Math.abs(valid.audioOutputContextLagMs - 10) < 1e-6);
    context.getOutputTimestamp = () => { throw new Error('device timestamp unavailable'); };
    assert.equal(h.media.getPlaybackDiagnostics().audioOutputTimestampAgeMs, undefined);
    assert.equal(h.media.getPlaybackDiagnostics().audioOutputTimestampState, 'failed');
    context.getOutputTimestamp = () => ({ contextTime: context.currentTime + 1, performanceTime: performance.now() + 1000 });
    context.baseLatency = NaN; context.outputLatency = -1;
    const future = h.media.getPlaybackDiagnostics();
    assert.equal(future.audioBaseLatencyMs, undefined); assert.equal(future.audioOutputLatencyMs, undefined);
    assert.equal(future.audioOutputTimestampState, 'future');
    assert.ok(future.audioOutputTimestampAgeMs < -900 && future.audioOutputTimestampAgeMs >= -1000);
    assert.ok(Math.abs(future.audioOutputContextLagMs + 1000) < 1e-6, 'a contradictory context estimate survives independently of future performance time');
    context.getOutputTimestamp = () => ({ contextTime: context.currentTime + 0.01, performanceTime: performance.now() - 4 });
    const ahead = h.media.getPlaybackDiagnostics();
    assert.equal(ahead.audioOutputTimestampState, 'context-ahead');
    assert.ok(Math.abs(ahead.audioOutputContextLagMs + 10) < 1e-6);
    context.baseLatency = 0.02; context.outputLatency = 0.03; context.sampleRate = 44100;
    assert.equal(h.media.getPlaybackDiagnostics().audioBaseLatencyMs, undefined, 'a retired format must not describe the new track');
    assert.equal(h.media.getPlaybackDiagnostics().audioOutputTimestampState, 'format-mismatch');
    context.sampleRate = 48000; context.state = 'closed';
    assert.equal(h.media.getPlaybackDiagnostics().audioOutputTimestampState, 'closed');
  } finally { h.media.dispose(); }
});


for (const [name, stamp, expected] of [
  ['startup pair', { contextTime: 0, performanceTime: 0 }, 'startup'],
  ['absent pair', undefined, 'invalid'],
  ['non-finite context', { contextTime: NaN, performanceTime: 1 }, 'invalid'],
  ['negative context', { contextTime: -1, performanceTime: 1 }, 'invalid'],
  ['negative performance', { contextTime: 0, performanceTime: -1 }, 'invalid'],
  ['zero performance after startup', { contextTime: 1, performanceTime: 0 }, 'invalid'],
]) test(`URL output diagnostics: ${name} is explicit without inventing timing or changing submission`, async () => {
  const h = await startSchedulingFixture();
  try {
    const before = h.media.getPlaybackDiagnostics();
    h.context().getOutputTimestamp = () => stamp;
    const after = h.media.getPlaybackDiagnostics();
    assert.equal(after.audioOutputTimestampState, expected);
    assert.equal(after.audioOutputTimestampAgeMs, undefined); assert.equal(after.audioOutputContextLagMs, undefined);
    for (const key of ['position', 'clockTime', 'clockPosition', 'scheduledEnd', 'audioScheduledFrames', 'audioRebufferStops'])
      assert.equal(after[key], before[key], `diagnostic API failures cannot change ${key}`);
  } finally { h.media.dispose(); }
});

test('URL renderer counters belong to the current context and do not alter PCM scheduling', async () => {
  const h = await startSchedulingFixture();
  try {
    const context = h.context(), before = h.media.getPlaybackDiagnostics();
    assert.equal(before.renderStatsState, 'unavailable');
    for (const key of ['renderUnderrunEvents', 'renderUnderrunDurationMs', 'renderTotalDurationMs']) assert.equal(before[key], undefined);
    let resets = 0;
    context.playbackStats = { underrunEvents: 2, underrunDuration: 0.00525, totalDuration: 12.5,
      resetLatency() { resets++; } };
    const observed = h.media.getPlaybackDiagnostics();
    assert.equal(observed.renderStatsState, 'available');
    assert.equal(observed.renderUnderrunEvents, 2); assert.equal(observed.renderUnderrunDurationMs, 5.25);
    assert.equal(observed.renderTotalDurationMs, 12500); assert.equal(resets, 0);
    for (const key of ['position', 'clockTime', 'clockPosition', 'scheduledEnd', 'audioScheduledFrames', 'audioRebufferStops'])
      assert.equal(observed[key], before[key], `renderer observations cannot change ${key}`);
    context.sampleRate = 44100;
    const stale = h.media.getPlaybackDiagnostics();
    assert.equal(stale.renderStatsState, 'unavailable');
    assert.equal(stale.renderUnderrunEvents, undefined, 'a retained old-format context cannot describe replacement audio');
    context.sampleRate = 48000;
    Object.defineProperty(context, 'playbackStats', { get() { throw new Error('unavailable renderer'); } });
    const failed = h.media.getPlaybackDiagnostics();
    assert.equal(failed.renderStatsState, 'failed'); assert.equal(failed.renderUnderrunEvents, undefined);
  } finally { h.media.dispose(); }
});
