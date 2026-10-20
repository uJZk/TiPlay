// SPDX-License-Identifier: GPL-3.0-only
// Synthetic decoded URL media. No captured media, network identifiers or worklet statistics.
const TONE_HZ = 997, AMPLITUDE = 0.25, PHASE = 0.37, INDEX_SCALE = 2 ** 20;

/** Channel 0 is a known continuous tone; channel 1 identifies every source frame exactly. */
export function urlAudioSample(frame, channel, sampleRate) {
  return channel === 0 ? AMPLITUDE * Math.sin(2 * Math.PI * TONE_HZ * frame / sampleRate + PHASE)
    : (frame + 1) / INDEX_SCALE;
}

/** Inspect the plan supplied to AudioBufferSourceNodes; this is not a browser-render claim. */
export function renderScheduledUrlAudio(nodes, sampleRate, seconds) {
  const frames = Math.round(seconds * sampleRate), channels = [new Float32Array(frames), new Float32Array(frames)];
  const coverage = new Uint16Array(frames);
  const anchorTime = nodes.find(node => Number.isFinite(node.time))?.time || 0;
  for (const node of nodes) {
    if (!node.buffer || !Number.isFinite(node.time)) continue;
    if (node.buffer.sampleRate !== sampleRate) throw new Error('Plan oracle requires equal input/output rates; use real OfflineAudioContext for resampling.');
    const first = Math.round((node.time - anchorTime) * sampleRate);
    const stop = Number.isFinite(node.stopTime) ? Math.round((node.stopTime - anchorTime) * sampleRate) : Infinity;
    for (let index = 0; index < node.buffer.length; index++) {
      const at = first + index;
      if (at < 0 || at >= frames || at >= stop) continue;
      coverage[at]++;
      for (let channel = 0; channel < channels.length; channel++) channels[channel][at] += node.buffer.getChannelData(channel)[index];
    }
  }
  return { channels, coverage, sampleRate, anchorTime };
}

/** Independent original-signal oracle, including frame identity and local tone phase. */
export function inspectUrlAudioSignal(rendered, fromSeconds, toSeconds) {
  const { channels: [left, right], coverage, sampleRate } = rendered;
  const first = Math.max(1, Math.round(fromSeconds * sampleRate)), last = Math.min(left.length - 1, Math.round(toSeconds * sampleRate));
  const omega = 2 * Math.PI * TONE_HZ / sampleRate;
  let gaps = 0, overlaps = 0, frameIdentityErrors = 0, clickResidualFrames = 0, errorEnergy = 0, referenceEnergy = 0;
  let maximumError = 0, maximumStepResidual = 0, maximumPhaseErrorRadians = 0, previous = null;
  let duplicateFrames = 0, skippedFrames = 0, maximumGapRun = 0, gapRun = 0;
  for (let frame = first; frame < last; frame++) {
    const expected = Math.fround(urlAudioSample(frame, 0, sampleRate));
    const error = left[frame] - expected;
    maximumError = Math.max(maximumError, Math.abs(error)); errorEnergy += error ** 2; referenceEnergy += expected ** 2;
    if (coverage[frame] === 0) { gaps++; gapRun++; maximumGapRun = Math.max(maximumGapRun, gapRun); }
    else gapRun = 0;
    if (coverage[frame] > 1) overlaps++;
    const identity = Math.round(right[frame] * INDEX_SCALE) - 1;
    if (coverage[frame] !== 1 || identity !== frame) frameIdentityErrors++;
    if (coverage[frame] === 1 && previous !== null) {
      if (identity <= previous) duplicateFrames++;
      else if (identity > previous + 1) skippedFrames += identity - previous - 1;
    }
    previous = coverage[frame] === 1 ? identity : null;
    const expectedStep = expected - Math.fround(urlAudioSample(frame - 1, 0, sampleRate));
    const stepResidual = Math.abs(left[frame] - left[frame - 1] - expectedStep);
    maximumStepResidual = Math.max(maximumStepResidual, stepResidual);
    if (stepResidual > 0.01) clickResidualFrames++;
    const sinPhase = left[frame] / AMPLITUDE;
    const cosPhase = (left[frame + 1] / AMPLITUDE - sinPhase * Math.cos(omega)) / Math.sin(omega);
    const delta = Math.atan2(sinPhase, cosPhase) - (omega * frame + PHASE);
    maximumPhaseErrorRadians = Math.max(maximumPhaseErrorRadians, Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))));
  }
  return { frames: last - first, gaps, overlaps, frameIdentityErrors, duplicateFrames, skippedFrames, maximumGapRun,
    maximumError, maximumStepResidual, clickResidualFrames, maximumPhaseErrorRadians,
    relativeErrorDb: errorEnergy ? 10 * Math.log10(errorEnergy / referenceEnergy) : -Infinity };
}
